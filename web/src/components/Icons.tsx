/** 線画アイコン（24px グリッド、currentColor） */
type P = { size?: number };
const svg = (size: number, children: React.ReactNode) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);
export const IconSpeaker = ({ size = 22 }: P) => svg(size, <><path d="M11 5 6 9H3v6h3l5 4V5z" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M18.5 5.5a9 9 0 0 1 0 13" /></>);
export const IconSlow = ({ size = 22 }: P) => svg(size, <><path d="M11 5 6 9H3v6h3l5 4V5z" /><path d="M15.5 9.5a3.5 3.5 0 0 1 0 5" /><text x="16" y="22" fontSize="7" stroke="none" fill="currentColor" fontWeight="700">½</text></>);
export const IconMic = ({ size = 22 }: P) => svg(size, <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0" /><path d="M12 18v3" /></>);
export const IconHome = ({ size = 24 }: P) => svg(size, <><path d="M3 11 12 4l9 7" /><path d="M5 10v10h14V10" /></>);
export const IconBook = ({ size = 24 }: P) => svg(size, <><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5z" /><path d="M4 19a2 2 0 0 1 2-2h13" /></>);
export const IconChat = ({ size = 24 }: P) => svg(size, <path d="M4 5h16v11H9l-5 4V5z" />);
export const IconChart = ({ size = 24 }: P) => svg(size, <><path d="M4 20V4" /><path d="M4 20h16" /><path d="M7 15c3-7 6-7 12-8" /></>);
export const IconGear = ({ size = 24 }: P) => svg(size, <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" /></>);
export const IconClose = ({ size = 22 }: P) => svg(size, <path d="M6 6l12 12M18 6 6 18" />);
