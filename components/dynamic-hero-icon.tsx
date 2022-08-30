import dynamic from "next/dynamic";
import { FC, HTMLAttributes } from "react";

type HeroIconProps = {
  name: IconName;
  className?: HTMLAttributes<string>["className"];
  style?: "solid" | "outline" | "mini";
};
export const HeroIcon: FC<HeroIconProps> = ({ name, className = "", style = "solid" }) => {
  /*= =============== TODO REMOVE WHEN FIXED ================ */

  const Icon:
    | React.ComponentClass<React.SVGProps<SVGSVGElement>>
    | React.FunctionComponent<React.SVGProps<SVGSVGElement>> = dynamic(
    () => {
      if (style === "solid") {
        const asyncImport = {
          InformationCircleIcon: import("@heroicons/react/24/solid/InformationCircleIcon"),
          XMarkIcon: import("@heroicons/react/24/solid/XMarkIcon"),
          XCircleIcon: import("@heroicons/react/24/solid/XCircleIcon"),
          CheckCircleIcon: import("@heroicons/react/24/solid/CheckCircleIcon"),
          ExclamationCircleIcon: import("@heroicons/react/24/solid/ExclamationCircleIcon"),
          Bars2Icon: import("@heroicons/react/24/solid/Bars2Icon"),
          Bars3BottomLeftIcon: import("@heroicons/react/24/solid/Bars3BottomLeftIcon"),
          ArrowLongRightIcon: import("@heroicons/react/24/solid/ArrowLongRightIcon"),
          ArrowLongLeftIcon: import("@heroicons/react/24/solid/ArrowLongLeftIcon"),
          LinkIcon: import("@heroicons/react/24/solid/LinkIcon"),
          StarIcon: import("@heroicons/react/24/solid/StarIcon"),
          ClipboardDocumentCheckIcon: import(
            "@heroicons/react/24/solid/ClipboardDocumentCheckIcon"
          ),
          ClipboardDocumentIcon: import("@heroicons/react/24/solid/ClipboardDocumentIcon"),
          HeartIcon: import("@heroicons/react/24/solid/HeartIcon"),
          MoonIcon: import("@heroicons/react/24/solid/MoonIcon"),
          SunIcon: import("@heroicons/react/24/solid/SunIcon"),
        }[name];

        return asyncImport.then((mod) => mod);
      }

      if (style === "outline") {
        const asyncImport = {
          InformationCircleIcon: import("@heroicons/react/24/outline/InformationCircleIcon"),
          XMarkIcon: import("@heroicons/react/24/outline/XMarkIcon"),
          XCircleIcon: import("@heroicons/react/24/outline/XCircleIcon"),
          CheckCircleIcon: import("@heroicons/react/24/outline/CheckCircleIcon"),
          ExclamationCircleIcon: import("@heroicons/react/24/outline/ExclamationCircleIcon"),
          Bars2Icon: import("@heroicons/react/24/outline/Bars2Icon"),
          Bars3BottomLeftIcon: import("@heroicons/react/24/outline/Bars3BottomLeftIcon"),
          StarIcon: import("@heroicons/react/24/outline/StarIcon"),
          ClipboardDocumentCheckIcon: import(
            "@heroicons/react/24/outline/ClipboardDocumentCheckIcon"
          ),
          ClipboardDocumentIcon: import("@heroicons/react/24/outline/ClipboardDocumentIcon"),
          HeartIcon: import("@heroicons/react/24/outline/HeartIcon"),
          MoonIcon: import("@heroicons/react/24/outline/MoonIcon"),
          SunIcon: import("@heroicons/react/24/outline/SunIcon"),
        }[name];

        return asyncImport.then((mod) => mod);
      }

      if (style === "mini") {
        const asyncImport = {
          InformationCircleIcon: import("@heroicons/react/20/solid/InformationCircleIcon"),
          XMarkIcon: import("@heroicons/react/20/solid/XMarkIcon"),
          XCircleIcon: import("@heroicons/react/20/solid/XCircleIcon"),
          CheckCircleIcon: import("@heroicons/react/20/solid/CheckCircleIcon"),
          ExclamationCircleIcon: import("@heroicons/react/20/solid/ExclamationCircleIcon"),
          Bars2Icon: import("@heroicons/react/20/solid/Bars2Icon"),
          Bars3BottomLeftIcon: import("@heroicons/react/20/solid/Bars3BottomLeftIcon"),
          StarIcon: import("@heroicons/react/20/solid/StarIcon"),
          ClipboardDocumentCheckIcon: import(
            "@heroicons/react/20/solid/ClipboardDocumentCheckIcon"
          ),
          ClipboardDocumentIcon: import("@heroicons/react/20/solid/ClipboardDocumentIcon"),
          HeartIcon: import("@heroicons/react/20/solid/HeartIcon"),
          MoonIcon: import("@heroicons/react/20/solid/MoonIcon"),
          SunIcon: import("@heroicons/react/20/solid/SunIcon"),
        }[name];
        return asyncImport.then((mod) => mod);
      }
    },
    {
      ssr: false,
    }
  );

  return <Icon className={className} />;
};

export type IconName =
  | "AcademicCapIcon"
  | "AdjustmentsHorizontalIcon"
  | "AdjustmentsVerticalIcon"
  | "ArchiveBoxArrowDownIcon"
  | "ArchiveBoxXMarkIcon"
  | "ArchiveBoXMarkIcon"
  | "ArrowDownCircleIcon"
  | "ArrowDownLeftIcon"
  | "ArrowDownOnSquareStackIcon"
  | "ArrowDownOnSquareIcon"
  | "ArrowDownRightIcon"
  | "ArrowDownTrayIcon"
  | "ArrowDownIcon"
  | "ArrowLeftCircleIcon"
  | "ArrowLeftOnRectangleIcon"
  | "ArrowLeftIcon"
  | "ArrowLongDownIcon"
  | "ArrowLongLeftIcon"
  | "ArrowLongRightIcon"
  | "ArrowLongUpIcon"
  | "ArrowPathIcon"
  | "ArrowRightCircleIcon"
  | "ArrowRightOnRectangleIcon"
  | "ArrowRightIcon"
  | "ArrowTopRightOnSquareIcon"
  | "ArrowTrendingDownIcon"
  | "ArrowTrendingUpIcon"
  | "ArrowUpCircleIcon"
  | "ArrowUpLeftIcon"
  | "ArrowUpOnSquareStackIcon"
  | "ArrowUpOnSquareIcon"
  | "ArrowUpRightIcon"
  | "ArrowUpTrayIcon"
  | "ArrowUpIcon"
  | "ArrowUturnDownIcon"
  | "ArrowUturnLeftIcon"
  | "ArrowUturnRightIcon"
  | "ArrowUturnUpIcon"
  | "ArrowsPointingInIcon"
  | "ArrowsPointingOutIcon"
  | "ArrowsRightLeftIcon"
  | "ArrowsUpDownIcon"
  | "AtSymbolIcon"
  | "BackspaceIcon"
  | "BackwardIcon"
  | "BanknotesIcon"
  | "Bars2Icon"
  | "Bars3BottomLeftIcon"
  | "Bars3BottomRightIcon"
  | "Bars3CenterLeftIcon"
  | "Bars3Icon"
  | "Bars4Icon"
  | "BeakerIcon"
  | "BellAlertIcon"
  | "BellSlashIcon"
  | "BellSnoozeIcon"
  | "BellIcon"
  | "BoltSlashIcon"
  | "BoltIcon"
  | "BookOpenIcon"
  | "BookmarkSlashIcon"
  | "BookmarkSquareIcon"
  | "BookmarkIcon"
  | "BriefcaseIcon"
  | "BuildingLibraryIcon"
  | "BuildingOffice2Icon"
  | "BuildingOfficeIcon"
  | "BuildingStorefrontIcon"
  | "CakeIcon"
  | "CalculatorIcon"
  | "CalendarDaysIcon"
  | "CalendarIcon"
  | "CameraIcon"
  | "ChartBarSquareIcon"
  | "ChartBarIcon"
  | "ChartPieIcon"
  | "ChatBubbleBottomCenterTextIcon"
  | "ChatBubbleBottomCenterIcon"
  | "ChatBubbleLeftEllipsisIcon"
  | "ChatBubbleLeftRightIcon"
  | "ChatBubbleLeftIcon"
  | "ChatBubbleOvalLeftEllipsisIcon"
  | "ChatBubbleOvalLeftIcon"
  | "CheckBadgeIcon"
  | "CheckCircleIcon"
  | "CheckIcon"
  | "ChevronDoubleDownIcon"
  | "ChevronDoubleLeftIcon"
  | "ChevronDoubleRightIcon"
  | "ChevronDoubleUpIcon"
  | "ChevronDownIcon"
  | "ChevronLeftIcon"
  | "ChevronRightIcon"
  | "ChevronUpIcon"
  | "CircleStackIcon"
  | "ClipboardDocumentCheckIcon"
  | "ClipboardDocumentListIcon"
  | "ClipboardDocumentIcon"
  | "ClipboardIcon"
  | "ClockIcon"
  | "CloudArrowDownIcon"
  | "CloudArrowUpIcon"
  | "CloudIcon"
  | "CodeSquareIcon"
  | "CodeIcon"
  | "Cog6ToothIcon"
  | "Cog8ToothIcon"
  | "CogIcon"
  | "CommandLineIcon"
  | "ComputerDesktopIcon"
  | "CpuChipIcon"
  | "CreditCardIcon"
  | "CubeIcon"
  | "CurrencyDollarIcon"
  | "CurrencyEuroIcon"
  | "CurrencyPoundIcon"
  | "CurrencyRupeeIcon"
  | "CurrencyYenIcon"
  | "CursorArrowRaysIcon"
  | "CursorArrowRippleIcon"
  | "DevicePhoneMobileIcon"
  | "DeviceTabletIcon"
  | "DocumentArrowDownIcon"
  | "DocumentArrowUpIcon"
  | "DocumentChartBarIcon"
  | "DocumentCheckIcon"
  | "DocumentDuplicateIcon"
  | "DocumentMagnifyingGlassIcon"
  | "DocumentMinusIcon"
  | "DocumentPlusIcon"
  | "DocumentTextIcon"
  | "DocumentIcon"
  | "EllipsisHorizontalCircleIcon"
  | "EllipsisHorizontalIcon"
  | "EllipsisVerticalIcon"
  | "EnvelopeOpenIcon"
  | "EnvelopeIcon"
  | "ExclamationCircleIcon"
  | "ExclamationTriangleIcon"
  | "EyeSlashIcon"
  | "EyeIcon"
  | "FaceFrownIcon"
  | "FaceSmileIcon"
  | "FilmIcon"
  | "FingerPrintIcon"
  | "FireIcon"
  | "FlagIcon"
  | "FolderArrowDownIcon"
  | "FolderMinusIcon"
  | "FolderOpenIcon"
  | "FolderPlusIcon"
  | "FolderIcon"
  | "ForwardIcon"
  | "FunnelIcon"
  | "GifIcon"
  | "GiftTopIcon"
  | "GiftIcon"
  | "GlobeAltIcon"
  | "GlobeAmericasIcon"
  | "GlobeAsiaAustraliaIcon"
  | "GlobeEuropeAfricaIcon"
  | "HandRaisedIcon"
  | "HandThumbDownIcon"
  | "HandThumbUpIcon"
  | "HashtagIcon"
  | "HeartIcon"
  | "HomeModernIcon"
  | "HomeIcon"
  | "IdentificationIcon"
  | "InboxArrowDownIcon"
  | "InboxStackIcon"
  | "InboXMarkIcon"
  | "InformationCircleIcon"
  | "KeyIcon"
  | "LanguageIcon"
  | "LifebuoyIcon"
  | "LightBulbIcon"
  | "LinkIcon"
  | "ListBulletIcon"
  | "LockClosedIcon"
  | "LockOpenIcon"
  | "MagnifyingGlassCircleIcon"
  | "MagnifyingGlassMinusIcon"
  | "MagnifyingGlassPlusIcon"
  | "MagnifyingGlassIcon"
  | "MapPinIcon"
  | "MapIcon"
  | "MegaphoneIcon"
  | "MicrophoneIcon"
  | "MinusCircleIcon"
  | "MinusIcon"
  | "MoonIcon"
  | "MusicalNoteIcon"
  | "NewspaperIcon"
  | "NoSymbolIcon"
  | "PaperAirplaneIcon"
  | "PaperClipIcon"
  | "PauseIcon"
  | "PencilSquareIcon"
  | "PencilIcon"
  | "PhoneArrowDownLeftIcon"
  | "PhoneArrowUpRightIcon"
  | "PhoneXMarkIcon"
  | "PhoneIcon"
  | "PhotoIcon"
  | "PlayPauseIcon"
  | "PlayIcon"
  | "PlusCircleIcon"
  | "PlusIcon"
  | "PresentationChartBarIcon"
  | "PresentationChartLineIcon"
  | "PrinterIcon"
  | "PuzzlePieceIcon"
  | "QrCodeIcon"
  | "QuestionMarkCircleIcon"
  | "QueueListIcon"
  | "RadioIcon"
  | "ReceiptPercentIcon"
  | "ReceiptRefundIcon"
  | "RectangleGroupIcon"
  | "RectangleStackIcon"
  | "ScaleIcon"
  | "ScissorsIcon"
  | "ServerStackIcon"
  | "ServerIcon"
  | "ShareIcon"
  | "ShieldCheckIcon"
  | "ShieldExclamationIcon"
  | "ShoppingBagIcon"
  | "ShoppingCartIcon"
  | "SignalSlashIcon"
  | "SignalIcon"
  | "SparklesIcon"
  | "SpeakerWaveIcon"
  | "SpeakerXMarkIcon"
  | "Square2StackIcon"
  | "Squares2X2Icon"
  | "SquaresPlusIcon"
  | "StarIcon"
  | "StopIcon"
  | "SunIcon"
  | "SwatchIcon"
  | "TableCellsIcon"
  | "TagIcon"
  | "TicketIcon"
  | "TrashIcon"
  | "TruckIcon"
  | "UserCircleIcon"
  | "UserGroupIcon"
  | "UserPlusIcon"
  | "UserIcon"
  | "UsersIcon"
  | "VideoCameraSlashIcon"
  | "VideoCameraIcon"
  | "ViewColumnsIcon"
  | "WifiIcon"
  | "WrenchScrewdriverIcon"
  | "WrenchIcon"
  | "XCircleIcon"
  | "XMarkIcon";
