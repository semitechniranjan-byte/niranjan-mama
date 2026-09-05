import logging
from datetime import datetime
from typing import Optional
from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorClient

try:
    from .config import settings
except ImportError:  # pragma: no cover
    from config import settings

logger = logging.getLogger(__name__)


class DatabaseService:
    def __init__(self) -> None:
        self.client = AsyncIOMotorClient(settings.MONGO_URI)
        self.db = self.client[settings.MONGO_DB]
        self.sessions = self.db["sessions"]
        self.conversations = self.db["conversations"]
        self.executions = self.db["executions"]
        self.templates = self.db["templates"]
        self.agent_rooms = self.db["agent_rooms"]
        self.agents = self.db["agents"]
        self.queuecalls = self.db["queuecalls"]
        self.runqueuecalls = self.db["runqueuecalls"]
        self.background_jobs = self.db["background_jobs"]
        self.datasheets = self.db["datasheets"]
        self.campaigns = self.db["campaigns"]
        self.datasheet_templates = self.db["datasheet_templates"]
        self.dispositions = self.db["dispositions"]
        self.mapping_keys = self.db["mapping_keys"]
        self.app_settings = self.db["app_settings"]
        self.ready = False

    async def initialize(self) -> bool:
        try:
            await self.client.admin.command("ping")
            await self.sessions.create_index("session_id", unique=True)
            # Every session list sorts by created_at and most filter by status. Without
            # these the paginated list scans the whole collection on each page.
            await self.sessions.create_index([("created_at", -1)])
            await self.sessions.create_index([("status", 1), ("created_at", -1)])
            await self.conversations.create_index([("session_id", 1), ("timestamp", 1)])
            await self.executions.create_index("created_at")
            await self.queuecalls.create_index("status")
            await self.runqueuecalls.create_index("status")
            await self.templates.create_index("name")
            await self.agent_rooms.create_index("room_name")
            await self.agents.create_index([("name", 1), ("room_name", 1)])
            await self.datasheets.create_index("created_at")
            await self.campaigns.create_index("created_at")
            self.ready = True
            logger.info("MongoDB initialized for minimal voice clone")
            return True
        except Exception as exc:
            logger.warning("MongoDB unavailable, continuing without persistence: %s", exc)
            self.ready = False
            return False

    async def create_session(self, phone_number: str, direction: str = "outbound", execution_id: Optional[str] = None) -> dict:
        session = {
            "session_id": f"{phone_number}-{__import__('uuid').uuid4().hex[:8]}",
            "phone_number": phone_number,
            "direction": direction,
            "created_at": datetime.utcnow(),
            "started_at": datetime.utcnow(),
            "last_activity_at": datetime.utcnow(),
            "status": "active",
            "active": True,
            "model_data": {},
            "format_values": {},
            "dynamic_fields": {},
            "system_prompt": None,
        }
        if execution_id:
            session["execution_id"] = execution_id
        if self.ready:
            await self.sessions.insert_one(session)
        return session

    async def create_execution(self, name: str) -> str:
        if not self.ready:
            return ""
        doc = {"name": name, "created_at": datetime.utcnow()}
        result = await self.executions.insert_one(doc)
        return str(result.inserted_id)

    async def mark_session_state(self, session_id: str, status: str = "active", **kwargs) -> bool:
        if not self.ready or not session_id:
            return False
        update_data = {
            "status": status,
            "active": status != "ended",
            "last_activity_at": datetime.utcnow(),
            **kwargs,
        }
        result = await self.sessions.update_one({"session_id": session_id}, {"$set": update_data})
        return result.modified_count > 0

    async def finalize_session(self, session_id: str, status: str = "completed", reason: Optional[str] = None, **kwargs) -> bool:
        if not self.ready or not session_id:
            return False
        update_data = {
            "status": status,
            "active": False,
            "ended_at": datetime.utcnow(),
            "last_activity_at": datetime.utcnow(),
            **kwargs,
        }
        if reason is not None:
            update_data["reason"] = reason
        result = await self.sessions.update_one({"session_id": session_id}, {"$set": update_data})
        return result.modified_count > 0

    async def save_conversation_turn(self, session_id: str, role: str, content: str) -> None:
        if not self.ready:
            return
        await self.conversations.insert_one({
            "session_id": session_id,
            "role": role,
            "content": content,
            "timestamp": datetime.utcnow(),
        })

    async def get_conversation_history(self, session_id: str) -> list[dict]:
        if not self.ready:
            return []
        cursor = self.conversations.find({"session_id": session_id}).sort("timestamp", 1)
        return [doc async for doc in cursor]

    async def get_conversation_history_route(self, session_id: str) -> list[dict]:
        return await self.get_conversation_history(session_id)

    async def get_session(self, session_id: str) -> Optional[dict]:
        if not self.ready:
            return None
        return await self.sessions.find_one({"session_id": session_id})

    async def update_session(self, session_id: str, **kwargs) -> None:
        if not self.ready:
            return
        await self.sessions.update_one({"session_id": session_id}, {"$set": kwargs})

    async def update_model_data(self, session_id: str, data: dict) -> None:
        """Merge fields into a session's model_data.

        This used to $set the whole object, so a caller writing one field erased every
        other one. Adding a summary to 71 already-scored calls took the disposition detail
        - promise date, cooperation, what the customer said - with it. Writing field by
        field means a partial update stays partial.
        """
        if not self.ready or not data:
            return
        await self.sessions.update_one(
            {"session_id": session_id},
            {"$set": {f"model_data.{key}": value for key, value in data.items()}},
        )

    async def add_conversation_message(self, session_id: str, role: str, content: str, **kwargs) -> str:
        if not self.ready:
            return ""
        doc = {
            "session_id": session_id,
            "role": role,
            "content": content,
            "timestamp": datetime.utcnow(),
            **kwargs,
        }
        result = await self.conversations.insert_one(doc)
        return str(result.inserted_id)

    async def update_conversation_message_timing(self, message_id: str, **kwargs) -> None:
        if not self.ready or not message_id:
            return
        try:
            await self.conversations.update_one({"_id": ObjectId(message_id)}, {"$set": kwargs})
        except Exception:
            return

    async def enqueue_call(self, payload: dict, status: str = "queued") -> str:
        if not self.ready:
            return ""
        doc = {
            "status": status,
            "created_at": datetime.utcnow(),
            "payload": payload or {},
            "to_number": payload.get("to_number", "") if payload else "",
            "from_number": payload.get("from_number") if payload else None,
        }
        result = await self.queuecalls.insert_one(doc)
        return str(result.inserted_id)

    async def create_template(self, data: dict) -> str:
        if not self.ready:
            return ""
        doc = {
            **data,
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow(),
        }
        result = await self.templates.insert_one(doc)
        return str(result.inserted_id)

    async def list_templates(self) -> list[dict]:
        if not self.ready:
            return []
        cursor = self.templates.find().sort("created_at", -1)
        items = []
        async for doc in cursor:
            doc["_id"] = str(doc.get("_id"))
            items.append(doc)
        return items

    async def get_template(self, template_id: str) -> Optional[dict]:
        if not self.ready:
            return None
        try:
            doc = await self.templates.find_one({"_id": ObjectId(template_id)})
        except Exception:
            return None
        if doc:
            doc["_id"] = str(doc.get("_id"))
        return doc

    async def update_template(self, template_id: str, data: dict) -> bool:
        if not self.ready:
            return False
        try:
            result = await self.templates.update_one(
                {"_id": ObjectId(template_id)},
                {"$set": {**data, "updated_at": datetime.utcnow()}},
            )
        except Exception:
            return False
        return result.modified_count > 0

    async def delete_template(self, template_id: str) -> bool:
        if not self.ready:
            return False
        try:
            result = await self.templates.delete_one({"_id": ObjectId(template_id)})
        except Exception:
            return False
        return result.deleted_count > 0

    async def create_datasheet_template(self, data: dict) -> str:
        if not self.ready:
            return ""
        doc = {
            **data,
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow(),
        }
        result = await self.datasheet_templates.insert_one(doc)
        return str(result.inserted_id)

    async def list_datasheet_templates(self) -> list[dict]:
        if not self.ready:
            return []
        cursor = self.datasheet_templates.find().sort("created_at", -1)
        items = []
        async for doc in cursor:
            doc["_id"] = str(doc.get("_id"))
            items.append(doc)
        return items

    async def get_datasheet_template(self, datasheet_template_id: str) -> Optional[dict]:
        if not self.ready:
            return None
        try:
            doc = await self.datasheet_templates.find_one({"_id": ObjectId(datasheet_template_id)})
        except Exception:
            return None
        if doc:
            doc["_id"] = str(doc.get("_id"))
        return doc

    async def update_datasheet_template(self, datasheet_template_id: str, data: dict) -> bool:
        if not self.ready:
            return False
        try:
            result = await self.datasheet_templates.update_one(
                {"_id": ObjectId(datasheet_template_id)},
                {"$set": {**data, "updated_at": datetime.utcnow()}},
            )
        except Exception:
            return False
        return result.modified_count > 0

    async def delete_datasheet_template(self, datasheet_template_id: str) -> bool:
        if not self.ready:
            return False
        try:
            result = await self.datasheet_templates.delete_one({"_id": ObjectId(datasheet_template_id)})
        except Exception:
            return False
        return result.deleted_count > 0

    async def get_dispositions(self) -> list[dict]:
        if not self.ready:
            return []
        doc = await self.dispositions.find_one({"name": "disposition"})
        return (doc or {}).get("data", [])

    async def set_dispositions(self, data: list[dict]) -> None:
        if not self.ready:
            return
        await self.dispositions.update_one(
            {"name": "disposition"},
            {"$set": {"name": "disposition", "data": data, "updated_at": datetime.utcnow()}},
            upsert=True,
        )

    async def create_agent(self, data: dict) -> str:
        if not self.ready:
            return ""
        doc = {**data, "created_at": datetime.utcnow(), "updated_at": datetime.utcnow()}
        result = await self.agents.insert_one(doc)
        return str(result.inserted_id)

    async def list_agents(self) -> list[dict]:
        if not self.ready:
            return []
        cursor = self.agents.find().sort("created_at", 1)
        items = []
        async for doc in cursor:
            doc["_id"] = str(doc.get("_id"))
            items.append(doc)
        return items

    async def get_agent(self, agent_id: str) -> Optional[dict]:
        if not self.ready:
            return None
        try:
            doc = await self.agents.find_one({"_id": ObjectId(agent_id)})
        except Exception:
            return None
        if doc:
            doc["_id"] = str(doc.get("_id"))
        return doc

    async def update_agent(self, agent_id: str, data: dict) -> bool:
        if not self.ready:
            return False
        try:
            result = await self.agents.update_one(
                {"_id": ObjectId(agent_id)},
                {"$set": {**data, "updated_at": datetime.utcnow()}},
            )
        except Exception:
            return False
        return result.modified_count > 0

    async def delete_agent(self, agent_id: str) -> bool:
        if not self.ready:
            return False
        try:
            result = await self.agents.delete_one({"_id": ObjectId(agent_id)})
        except Exception:
            return False
        return result.deleted_count > 0

    async def get_app_settings(self) -> dict:
        if not self.ready:
            return {}
        doc = await self.app_settings.find_one({"name": "app_settings"})
        if not doc:
            return {}
        doc.pop("_id", None)
        doc.pop("name", None)
        return doc

    async def set_app_settings(self, data: dict) -> dict:
        if not self.ready:
            return {}
        await self.app_settings.update_one(
            {"name": "app_settings"},
            {"$set": {**data, "name": "app_settings", "updated_at": datetime.utcnow()}},
            upsert=True,
        )
        return await self.get_app_settings()

    async def get_mapping_keys(self) -> dict:
        if not self.ready:
            return {}
        doc = await self.mapping_keys.find_one({"name": "mapping_keys"})
        return (doc or {}).get("categories", {})

    async def set_mapping_keys(self, categories: dict) -> None:
        if not self.ready:
            return
        await self.mapping_keys.update_one(
            {"name": "mapping_keys"},
            {"$set": {"name": "mapping_keys", "categories": categories, "updated_at": datetime.utcnow()}},
            upsert=True,
        )

    async def create_datasheet(self, name: str, datasheet_template_id: str, columns: list[str], rows: list[dict]) -> str:
        if not self.ready:
            return ""
        row_docs = [
            {
                "row_index": idx,
                "data": row,
                "status": "pending",
                "disposition_code": None,
                "model_data": {},
                "session_id": None,
            }
            for idx, row in enumerate(rows)
        ]
        doc = {
            "name": name,
            "datasheet_template_id": datasheet_template_id,
            "columns": columns,
            "rows": row_docs,
            "row_count": len(row_docs),
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow(),
        }
        result = await self.datasheets.insert_one(doc)
        return str(result.inserted_id)

    async def list_datasheets(self) -> list[dict]:
        if not self.ready:
            return []
        cursor = self.datasheets.find({}, {"rows": 0}).sort("created_at", -1)
        items = []
        async for doc in cursor:
            doc["_id"] = str(doc.get("_id"))
            items.append(doc)
        return items

    async def get_datasheet(self, datasheet_id: str) -> Optional[dict]:
        if not self.ready:
            return None
        try:
            doc = await self.datasheets.find_one({"_id": ObjectId(datasheet_id)})
        except Exception:
            return None
        if doc:
            doc["_id"] = str(doc.get("_id"))
        return doc

    async def get_datasheet_row(self, datasheet_id: str, row_index: int) -> Optional[dict]:
        """Fetch a single row without pulling the whole (potentially 20k-row) datasheet."""
        if not self.ready:
            return None
        try:
            doc = await self.datasheets.find_one(
                {"_id": ObjectId(datasheet_id), "rows.row_index": row_index},
                {"rows": {"$elemMatch": {"row_index": row_index}}},
            )
        except Exception:
            return None
        rows = (doc or {}).get("rows") or []
        return rows[0] if rows else None

    async def update_datasheet_row(self, datasheet_id: str, row_index: int, **fields) -> bool:
        if not self.ready:
            return False
        try:
            result = await self.datasheets.update_one(
                {"_id": ObjectId(datasheet_id)},
                {
                    "$set": {
                        **{f"rows.$[elem].{key}": value for key, value in fields.items()},
                        "updated_at": datetime.utcnow(),
                    }
                },
                array_filters=[{"elem.row_index": row_index}],
            )
        except Exception:
            return False
        return result.modified_count > 0

    async def delete_datasheet(self, datasheet_id: str) -> bool:
        if not self.ready:
            return False
        try:
            result = await self.datasheets.delete_one({"_id": ObjectId(datasheet_id)})
        except Exception:
            return False
        return result.deleted_count > 0

    async def update_datasheet(self, datasheet_id: str, data: dict) -> bool:
        if not self.ready:
            return False
        try:
            result = await self.datasheets.update_one(
                {"_id": ObjectId(datasheet_id)},
                {"$set": {**data, "updated_at": datetime.utcnow()}},
            )
        except Exception:
            return False
        return result.modified_count > 0

    async def create_campaign(
        self,
        name: str,
        mode: str,
        datasheet_id: str,
        prompt_template_id: str,
        total: int,
        template_variant: str = "default",
        use_case: Optional[str] = None,
        language: Optional[str] = None,
        agent_id: Optional[str] = None,
        agent_ids: Optional[list] = None,
    ) -> str:
        if not self.ready:
            return ""
        doc = {
            "name": name,
            "mode": mode,
            "datasheet_id": datasheet_id,
            "prompt_template_id": prompt_template_id,
            "template_variant": template_variant or "default",
            "use_case": use_case,
            "language": language or "auto",
            "agent_id": agent_id,
            "agent_ids": agent_ids or ([agent_id] if agent_id else []),
            "status": "draft",
            "stats": {
                "total": total,
                "queued": total,
                "calling": 0,
                "completed": 0,
                "no_answer": 0,
                "failed": 0,
            },
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow(),
        }
        result = await self.campaigns.insert_one(doc)
        return str(result.inserted_id)

    async def list_campaigns(self) -> list[dict]:
        if not self.ready:
            return []
        cursor = self.campaigns.find().sort("created_at", -1)
        items = []
        async for doc in cursor:
            doc["_id"] = str(doc.get("_id"))
            items.append(doc)
        return items

    async def get_campaign(self, campaign_id: str) -> Optional[dict]:
        if not self.ready:
            return None
        try:
            doc = await self.campaigns.find_one({"_id": ObjectId(campaign_id)})
        except Exception:
            return None
        if doc:
            doc["_id"] = str(doc.get("_id"))
        return doc

    async def update_campaign(self, campaign_id: str, **fields) -> bool:
        if not self.ready:
            return False
        try:
            result = await self.campaigns.update_one(
                {"_id": ObjectId(campaign_id)},
                {"$set": {**fields, "updated_at": datetime.utcnow()}},
            )
        except Exception:
            return False
        return result.modified_count > 0

    async def shift_campaign_stat(self, campaign_id: str, from_stat: Optional[str], to_stat: str) -> None:
        if not self.ready:
            return
        try:
            inc = {f"stats.{to_stat}": 1}
            if from_stat:
                inc[f"stats.{from_stat}"] = -1
            await self.campaigns.update_one(
                {"_id": ObjectId(campaign_id)},
                {"$inc": inc, "$set": {"updated_at": datetime.utcnow()}},
            )
        except Exception:
            return

    async def list_queue_calls(self, limit: int = 50) -> list[dict]:
        if not self.ready:
            return []
        cursor = self.queuecalls.find().sort("created_at", -1).limit(limit)
        items = []
        async for doc in cursor:
            doc["_id"] = str(doc.get("_id"))
            items.append(doc)
        return items

    async def claim_next_queue_call(self) -> dict:
        if not self.ready:
            return {}
        queue_doc = await self.queuecalls.find_one({"status": {"$in": ["queued", "ready"]}})
        if not queue_doc:
            return {}
        await self.queuecalls.update_one(
            {"_id": queue_doc["_id"]},
            {"$set": {"status": "processing", "processed_at": datetime.utcnow()}},
        )
        queue_doc["status"] = "processing"
        return queue_doc

    async def update_queue_call_status(self, queue_id: str, status: str, **kwargs) -> None:
        if not self.ready or not queue_id:
            return
        await self.queuecalls.update_one({"_id": ObjectId(queue_id)}, {"$set": {"status": status, **kwargs}})

    async def create_background_job(self, job_type: str, payload: dict, status: str = "pending") -> str:
        if not self.ready:
            return ""
        doc = {
            "job_type": job_type,
            "status": status,
            "created_at": datetime.utcnow(),
            "payload": payload or {},
        }
        result = await self.background_jobs.insert_one(doc)
        return str(result.inserted_id)

    async def get_background_job(self, job_id: str) -> Optional[dict]:
        if not self.ready or not job_id:
            return None
        try:
            job = await self.background_jobs.find_one({"_id": ObjectId(job_id)})
        except Exception:
            return None
        if job:
            job["_id"] = str(job.get("_id"))
        return job

    async def list_background_jobs(self, status: Optional[str] = None, limit: int = 20) -> list[dict]:
        if not self.ready:
            return []
        query = {}
        if status:
            query["status"] = status
        cursor = self.background_jobs.find(query).sort("created_at", -1).limit(limit)
        jobs = []
        async for job in cursor:
            job["_id"] = str(job.get("_id"))
            jobs.append(job)
        return jobs

    async def get_next_queue_call_data(self) -> dict:
        if not self.ready:
            return {}
        queue_doc = await self.runqueuecalls.find_one({"status": {"$ne": "processed"}})
        if queue_doc is None:
            queue_doc = await self.queuecalls.find_one({"status": {"$ne": "processed"}})
        if not queue_doc:
            return {}
        execution_doc = {}
        execution_id = queue_doc.get("execution_id")
        if execution_id:
            try:
                execution_doc = await self.executions.find_one({"_id": ObjectId(execution_id)}) or {}
            except Exception:
                execution_doc = {}
        return {"execution": execution_doc, "runqueuecall": queue_doc}
