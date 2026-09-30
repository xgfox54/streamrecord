// 이 파일은 tools/build_registry.py가 design/jeju-icons.svg에서 생성한다. 직접 고치지 말고 sprite를 고친 뒤 다시 생성한다.
// 장식 아이콘은 기본 aria-hidden이다. 의미가 있는 아이콘 버튼은 버튼에 접근성 이름(aria-label)을 준다.
import * as React from "react"

import { cn } from "@/lib/utils"

type JejuIconProps = React.ComponentProps<"svg">

function createIcon(name: string, viewBox: string, body: React.ReactNode) {
  function JejuSvgIcon({ className, ...props }: JejuIconProps) {
    return (
      <svg
        viewBox={viewBox}
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
        data-icon={name}
        className={cn("size-(--jeju-icon) shrink-0 [stroke-width:var(--jeju-icon-stroke)]", className)}
        {...props}
      >
        {body}
      </svg>
    )
  }
  JejuSvgIcon.displayName = name + "-icon"
  return JejuSvgIcon
}

const HomeIcon = createIcon("home", "0 0 24 24", <><path d="M3 11.5 12 4l9 7.5" /><path d="M5.5 10.5V20h13v-9.5" /><path d="M9.5 20v-5.5h5V20" /></>)
const SearchIcon = createIcon("search", "0 0 24 24", <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5" /></>)
const MenuIcon = createIcon("menu", "0 0 24 24", <path d="M4 7h16M4 12h16M4 17h16" />)
const CloseIcon = createIcon("close", "0 0 24 24", <path d="m6 6 12 12M18 6 6 18" />)
const ChevronRightIcon = createIcon("chevron-right", "0 0 24 24", <path d="m9 5 7 7-7 7" />)
const ChevronLeftIcon = createIcon("chevron-left", "0 0 24 24", <path d="m15 5-7 7 7 7" />)
const ChevronDownIcon = createIcon("chevron-down", "0 0 24 24", <path d="m5 9 7 7 7-7" />)
const ChevronUpIcon = createIcon("chevron-up", "0 0 24 24", <path d="m5 15 7-7 7 7" />)
const ArrowLeftIcon = createIcon("arrow-left", "0 0 24 24", <path d="M20 12H4M10 6l-6 6 6 6" />)
const ArrowRightIcon = createIcon("arrow-right", "0 0 24 24", <path d="M4 12h16M14 6l6 6-6 6" />)
const CheckIcon = createIcon("check", "0 0 24 24", <path d="m5 12.5 4.2 4.2L19 7" />)
const InfoIcon = createIcon("info", "0 0 24 24", <><circle cx="12" cy="12" r="9" /><path d="M12 10.5V17M12 7.2h.01" /></>)
const HelpIcon = createIcon("help", "0 0 24 24", <><circle cx="12" cy="12" r="9" /><path d="M9.6 9.3a2.5 2.5 0 1 1 3.3 2.4c-.6.2-.9.8-.9 1.4v.6M12 17.2h.01" /></>)
const WarningIcon = createIcon("warning", "0 0 24 24", <><path d="M12 3.5 21 20H3L12 3.5Z" /><path d="M12 9v5M12 17.2h.01" /></>)
const PlusIcon = createIcon("plus", "0 0 24 24", <path d="M12 5v14M5 12h14" />)
const MinusIcon = createIcon("minus", "0 0 24 24", <path d="M5 12h14" />)
const DownloadIcon = createIcon("download", "0 0 24 24", <><path d="M12 3v12M7.5 10.5 12 15l4.5-4.5" /><path d="M5 20h14" /></>)
const UploadIcon = createIcon("upload", "0 0 24 24", <><path d="M12 16V4M7.5 8.5 12 4l4.5 4.5" /><path d="M4.5 15v3.5a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5V15" /></>)
const FileIcon = createIcon("file", "0 0 24 24", <><path d="M13.5 3H7a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 7 21h10a1.5 1.5 0 0 0 1.5-1.5V8Z" /><path d="M13.5 3v5h5" /></>)
const FolderIcon = createIcon("folder", "0 0 24 24", <path d="M3.5 6.5A1.5 1.5 0 0 1 5 5h4l2 2.5h8a1.5 1.5 0 0 1 1.5 1.5v8.5A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5Z" />)
const EditIcon = createIcon("edit", "0 0 24 24", <><path d="M15.5 5.2 18.8 8.5 9 18.3l-4.2.9.9-4.2Z" /><path d="M13.5 20.5h6.5" /></>)
const DeleteIcon = createIcon("delete", "0 0 24 24", <><path d="M4.5 6.5h15M9.5 6.5V4.8A1.3 1.3 0 0 1 10.8 3.5h2.4a1.3 1.3 0 0 1 1.3 1.3v1.7" /><path d="M6.5 6.5 7.4 20a1.4 1.4 0 0 0 1.4 1.3h6.4A1.4 1.4 0 0 0 16.6 20l.9-13.5" /><path d="M10.5 10.5v6.5M13.5 10.5v6.5" /></>)
const CalendarIcon = createIcon("calendar", "0 0 24 24", <><rect x="3.5" y="5.5" width="17" height="15" rx="1.8" /><path d="M3.5 10h17M8 3.5v4M16 3.5v4" /></>)
const ClockIcon = createIcon("clock", "0 0 24 24", <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.2V12l3.2 2" /></>)
const FilterIcon = createIcon("filter", "0 0 24 24", <path d="M4 5.5h16l-6.3 7.4v5.6l-3.4 2v-7.6Z" />)
const SortIcon = createIcon("sort", "0 0 24 24", <><path d="M8 4.5v15M4.5 8 8 4.5 11.5 8" /><path d="M16 19.5v-15M12.5 16 16 19.5 19.5 16" /></>)
const RefreshIcon = createIcon("refresh", "0 0 24 24", <><path d="M19.5 12a7.5 7.5 0 1 1-2.4-5.5" /><path d="M19.8 4.5v4.2h-4.2" /></>)
const SettingsIcon = createIcon("settings", "0 0 24 24", <><circle cx="12" cy="12" r="3" /><path d="M12 3.5h.9l.5 2.3 2 .9 2-1.2.9.9-1.2 2 .9 2 2.3.5v1.8l-2.3.5-.9 2 1.2 2-.9.9-2-1.2-2 .9-.5 2.3h-1.8l-.5-2.3-2-.9-2 1.2-.9-.9 1.2-2-.9-2-2.3-.5v-1.8l2.3-.5.9-2-1.2-2 .9-.9 2 1.2 2-.9.5-2.3Z" /></>)
const UserIcon = createIcon("user", "0 0 24 24", <><circle cx="12" cy="8" r="3.8" /><path d="M4.8 20.2a7.6 7.6 0 0 1 14.4 0" /></>)
const UsersIcon = createIcon("users", "0 0 24 24", <><circle cx="9.2" cy="8.2" r="3.4" /><path d="M3 19.8a6.4 6.4 0 0 1 12.4 0" /><path d="M16 5.2a3.4 3.4 0 0 1 0 6.6M17.2 14.4a6.4 6.4 0 0 1 3.8 5.4" /></>)
const BuildingIcon = createIcon("building", "0 0 24 24", <><path d="M4.5 20.5V4.8A1.3 1.3 0 0 1 5.8 3.5h8.4a1.3 1.3 0 0 1 1.3 1.3v15.7" /><path d="M15.5 9.5h3.2a1.3 1.3 0 0 1 1.3 1.3v9.7M3 20.5h18" /><path d="M8 7.5h1M11 7.5h1M8 11.5h1M11 11.5h1M8 15.5h4v5" /></>)
const LocationIcon = createIcon("location", "0 0 24 24", <><path d="M12 21s6.5-6.1 6.5-10.5a6.5 6.5 0 1 0-13 0C5.5 14.9 12 21 12 21Z" /><circle cx="12" cy="10.2" r="2.4" /></>)
const PhoneIcon = createIcon("phone", "0 0 24 24", <path d="M6.2 3.8h3.1l1.5 3.8-2 1.4a10.5 10.5 0 0 0 5.2 5.2l1.4-2 3.8 1.5v3.1a1.6 1.6 0 0 1-1.8 1.6C11.2 17.9 6.1 12.8 4.6 5.6a1.6 1.6 0 0 1 1.6-1.8Z" />)
const MailIcon = createIcon("mail", "0 0 24 24", <><rect x="3.5" y="5.5" width="17" height="13" rx="1.8" /><path d="m4 7 8 5.5L20 7" /></>)
const PrintIcon = createIcon("print", "0 0 24 24", <><path d="M7 9V4.5h10V9" /><path d="M5.5 9h13a1.5 1.5 0 0 1 1.5 1.5v5H18v4H6v-4H4V10.5A1.5 1.5 0 0 1 5.5 9Z" /><path d="M8.5 15.5h7" /></>)
const ExternalLinkIcon = createIcon("external-link", "0 0 24 24", <><path d="M14 4.5h5.5V10" /><path d="m11.5 12.5 8-8" /><path d="M18 14.5v4.2a1.3 1.3 0 0 1-1.3 1.3H5.8a1.3 1.3 0 0 1-1.3-1.3V7.8a1.3 1.3 0 0 1 1.3-1.3H10" /></>)
const MoreIcon = createIcon("more", "0 0 24 24", <path d="M6 12h.01M12 12h.01M18 12h.01" />)
const LockIcon = createIcon("lock", "0 0 24 24", <><rect x="4.5" y="10.5" width="15" height="10" rx="1.8" /><path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7" /></>)
const UnlockIcon = createIcon("unlock", "0 0 24 24", <><rect x="4.5" y="10.5" width="15" height="10" rx="1.8" /><path d="M8 10.5V7.8a4 4 0 0 1 7.6-1.7" /></>)

const jejuIcons = {
  "home": HomeIcon,
  "search": SearchIcon,
  "menu": MenuIcon,
  "close": CloseIcon,
  "chevron-right": ChevronRightIcon,
  "chevron-left": ChevronLeftIcon,
  "chevron-down": ChevronDownIcon,
  "chevron-up": ChevronUpIcon,
  "arrow-left": ArrowLeftIcon,
  "arrow-right": ArrowRightIcon,
  "check": CheckIcon,
  "info": InfoIcon,
  "help": HelpIcon,
  "warning": WarningIcon,
  "plus": PlusIcon,
  "minus": MinusIcon,
  "download": DownloadIcon,
  "upload": UploadIcon,
  "file": FileIcon,
  "folder": FolderIcon,
  "edit": EditIcon,
  "delete": DeleteIcon,
  "calendar": CalendarIcon,
  "clock": ClockIcon,
  "filter": FilterIcon,
  "sort": SortIcon,
  "refresh": RefreshIcon,
  "settings": SettingsIcon,
  "user": UserIcon,
  "users": UsersIcon,
  "building": BuildingIcon,
  "location": LocationIcon,
  "phone": PhoneIcon,
  "mail": MailIcon,
  "print": PrintIcon,
  "external-link": ExternalLinkIcon,
  "more": MoreIcon,
  "lock": LockIcon,
  "unlock": UnlockIcon,
} as const

type JejuIconName = keyof typeof jejuIcons

function JejuIcon({ name, ...props }: JejuIconProps & { name: JejuIconName }) {
  const Icon = jejuIcons[name]
  return <Icon {...props} />
}

export {
  JejuIcon,
  jejuIcons,
  type JejuIconName,
  HomeIcon,
  SearchIcon,
  MenuIcon,
  CloseIcon,
  ChevronRightIcon,
  ChevronLeftIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  InfoIcon,
  HelpIcon,
  WarningIcon,
  PlusIcon,
  MinusIcon,
  DownloadIcon,
  UploadIcon,
  FileIcon,
  FolderIcon,
  EditIcon,
  DeleteIcon,
  CalendarIcon,
  ClockIcon,
  FilterIcon,
  SortIcon,
  RefreshIcon,
  SettingsIcon,
  UserIcon,
  UsersIcon,
  BuildingIcon,
  LocationIcon,
  PhoneIcon,
  MailIcon,
  PrintIcon,
  ExternalLinkIcon,
  MoreIcon,
  LockIcon,
  UnlockIcon,
}
