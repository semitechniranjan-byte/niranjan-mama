/**
 * Inline stroke icons (24x24, 1.75 stroke) used across the console.
 *
 * Hand-rolled rather than pulled from an icon package so the bundle stays dependency
 * free and every glyph shares one visual weight — emoji rendered inconsistently across
 * platforms and looked out of place next to the UI type.
 */
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function make(displayName: string, paths: string[], extra?: React.ReactNode) {
  const Component = ({ size = 18, ...props }: IconProps) => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
      {extra}
    </svg>
  );
  Component.displayName = displayName;
  return Component;
}

// Navigation
export const IconDashboard = make("IconDashboard", [
  "M3 3h7v9H3z",
  "M14 3h7v5h-7z",
  "M14 12h7v9h-7z",
  "M3 16h7v5H3z",
]);
export const IconCampaign = make("IconCampaign", [
  "m3 11 18-5v12L3 14v-3z",
  "M11.6 16.8a3 3 0 1 1-5.8-1.6",
]);
export const IconMessage = make("IconMessage", [
  "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
]);
export const IconPhone = make("IconPhone", [
  "M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z",
]);
export const IconUsers = make("IconUsers", [
  "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2",
  "M23 21v-2a4 4 0 0 0-3-3.87",
  "M16 3.13a4 4 0 0 1 0 7.75",
], <circle cx="9" cy="7" r="4" />);
export const IconChart = make("IconChart", ["M3 3v18h18", "M7 15l4-5 4 3 5-7"]);
export const IconTemplate = make("IconTemplate", [
  "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z",
  "M14 2v6h6",
  "M9 13h6",
  "M9 17h4",
]);
export const IconTable = make("IconTable", [
  "M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  "M3 9h18",
  "M9 9v12",
]);
export const IconSettings = make("IconSettings", [
  "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z",
]);
export const IconWaveform = make("IconWaveform", [
  "M2 12h3l3-8 4 16 3-8h7",
]);

// Capabilities
export const IconMic = make("IconMic", [
  "M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z",
  "M19 10v1a7 7 0 0 1-14 0v-1",
  "M12 18v4",
]);
export const IconCpu = make("IconCpu", [
  "M6 6h12v12H6z",
  "M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3",
]);
export const IconSpeaker = make("IconSpeaker", [
  "M11 5 6 9H2v6h4l5 4z",
  "M15.5 8.5a5 5 0 0 1 0 7",
  "M19 5a9 9 0 0 1 0 14",
]);
export const IconDatabase = make("IconDatabase", [
  "M12 8c4.97 0 9-1.34 9-3s-4.03-3-9-3-9 1.34-9 3 4.03 3 9 3z",
  "M21 12c0 1.66-4 3-9 3s-9-1.34-9-3",
  "M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5",
]);
export const IconPlug = make("IconPlug", [
  "M9 2v6M15 2v6",
  "M6 8h12v3a6 6 0 0 1-12 0z",
  "M12 17v5",
]);

// Status & misc
export const IconClock = make("IconClock", ["M12 6v6l4 2"], <circle cx="12" cy="12" r="9" />);
export const IconGlobe = make("IconGlobe", [
  "M2 12h20",
  "M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18z",
], <circle cx="12" cy="12" r="9" />);
export const IconTag = make("IconTag", [
  "M20.6 13.4 12 22l-9-9V3h10l7.6 7.6a2 2 0 0 1 0 2.8z",
], <circle cx="7.5" cy="7.5" r="1.5" />);
export const IconPulse = make("IconPulse", ["M22 12h-4l-3 8-4-16-3 8H2"]);
export const IconLink = make("IconLink", [
  "M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7",
  "M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7",
]);
export const IconLogs = make("IconLogs", [
  "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z",
  "M15 2v5h5",
  "M8 13h8M8 17h5",
]);
export const IconUser = make("IconUser", [
  "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2",
], <circle cx="12" cy="7" r="4" />);
export const IconHistory = make("IconHistory", [
  "M3 3v6h6",
  "M3.5 13a9 9 0 1 0 2.1-5.6L3 9",
  "M12 8v5l3.5 2",
]);
export const IconTrash = make("IconTrash", [
  "M3 6h18",
  "M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2",
  "M19 6l-.8 14a2 2 0 0 1-2 1.9H7.8a2 2 0 0 1-2-1.9L5 6",
  "M10 11v6M14 11v6",
]);
export const IconPencil = make("IconPencil", [
  "M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z",
]);
export const IconPlus = make("IconPlus", ["M12 5v14M5 12h14"]);
export const IconSearch = make("IconSearch", ["m21 21-4.3-4.3"], <circle cx="11" cy="11" r="8" />);
export const IconUpload = make("IconUpload", [
  "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4",
  "m17 8-5-5-5 5",
  "M12 3v12",
]);
export const IconDownload = make("IconDownload", [
  "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4",
  "m7 10 5 5 5-5",
  "M12 15V3",
]);
export const IconX = make("IconX", ["M18 6 6 18M6 6l12 12"]);
export const IconChevronRight = make("IconChevronRight", ["m9 18 6-6-6-6"]);
export const IconChevronDown = make("IconChevronDown", ["m6 9 6 6 6-6"]);
export const IconArrowRight = make("IconArrowRight", ["M5 12h14", "m12 5 7 7-7 7"]);
export const IconRefresh = make("IconRefresh", [
  "M21 2v6h-6",
  "M3 12a9 9 0 0 1 15-6.7L21 8",
  "M3 22v-6h6",
  "M21 12a9 9 0 0 1-15 6.7L3 16",
]);
export const IconCheck = make("IconCheck", ["M20 6 9 17l-5-5"]);
export const IconTarget = make("IconTarget", [], (
  <>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="5" />
    <circle cx="12" cy="12" r="1.5" />
  </>
));
export const IconClipboard = make("IconClipboard", [
  "M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2",
  "M9 2h6v4H9z",
  "M9 12h6M9 16h4",
]);
export const IconCloudUpload = make("IconCloudUpload", [
  "M17 17h1.5a3.5 3.5 0 0 0 .3-7A5.5 5.5 0 0 0 8.2 8.6 4 4 0 0 0 6 16.5h1",
  "m9 15 3-3 3 3",
  "M12 12v9",
]);
export const IconFile = make("IconFile", [
  "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z",
  "M14 2v6h6",
]);
export const IconEye = make("IconEye", [
  "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z",
], <circle cx="12" cy="12" r="3" />);
export const IconRocket = make("IconRocket", [
  "M5 13c-1.5 1.5-2 5-2 5s3.5-.5 5-2",
  "M14.5 4.5C17 2 21 2 21 2s0 4-2.5 6.5L13 14l-3-3z",
  "M10 11 7 8l-4 1 3 3",
  "M13 14l3 3-1 4-3-3",
]);
export const IconHeadset = make("IconHeadset", [
  "M4 14v-2a8 8 0 0 1 16 0v2",
  "M4 14h2a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z",
  "M20 14h-2a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1z",
]);
export const IconHourglass = make("IconHourglass", [
  "M6 2h12M6 22h12",
  "M8 2v4.5L12 11l4-4.5V2",
  "M8 22v-4.5L12 13l4 4.5V22",
]);
