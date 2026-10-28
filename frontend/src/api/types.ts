// Типы ответов бэкенда (backend/src). Держим вручную — API маленький.

export type VisitKind = 'DOCTOR' | 'PHARMACY';
export type PlaceKind = 'CLINIC' | 'PHARMACY';

export interface Me {
  id: string;
  login: string;
  fullName: string;
  isAdmin: boolean;
}

export interface VisitProduct {
  code: string;
  /** аптека, уп. */
  stock?: number;
  sold?: number;
  order?: number;
}

/** Потенциал врача: сколько назначений наших препаратов в день. */
export type Potential = 'LOW' | 'MEDIUM' | 'HIGH';

export interface Visit {
  id: string;
  clientId: string;
  date: string; // YYYY-MM-DD
  kind: VisitKind;
  placeName: string | null;
  address: string | null;
  fullName: string | null;
  specialty: string | null;
  phone: string | null;
  products: VisitProduct[];
  productsRaw: string | null;
  comment: string | null;
  /** врач: договорённость, факт выполнения, отклонение */
  agreement: string | null;
  fact: string | null;
  deviation: string | null;
  /** врач: потенциал, отмеченный на визите */
  potential?: Potential | null;
  templateRow: number | null;
  /** уже записан в файле шаблона: правка перезапишет его строку в отчёте */
  fromFile: boolean;
  createdAt: string;
}

export interface VisitInput {
  clientId: string;
  date: string;
  kind: VisitKind;
  placeName?: string;
  address?: string;
  fullName?: string;
  specialty?: string;
  phone?: string;
  products: VisitProduct[];
  comment?: string;
}

export interface Place {
  id: string;
  kind: PlaceKind;
  name: string;
  address: string | null;
}

export interface Contact {
  id: string;
  fullName: string;
  specialty: string | null;
  phone: string | null;
  place: Place | null;
}

export interface TemplateSummary {
  id: string;
  month: string;
  originalName: string;
  createdAt: string;
}

export interface ImportCounts {
  created: number;
  linked: number;
}

/** Импорт строк файла: сразу (сервер без Redis) или фоновой задачей. */
export type ImportStatus =
  ({ status: 'done' } & ImportCounts) | { status: 'queued'; jobId: string };

/** GET /templates/import/:jobId */
export type ImportJobStatus =
  | ({ status: 'done' } & ImportCounts)
  | { status: 'queued'; state: string; attempts: number }
  | { status: 'failed'; error: string };

export interface TemplateUploaded extends TemplateSummary {
  sheetName: string;
  days: number;
  firstDay?: string;
  lastDay?: string;
  import?: ImportStatus;
  /** есть, когда импорт уже прошёл в самом запросе */
  imported?: ImportCounts;
}

/** Строка дня в готовом файле — экран «Предпросмотр». */
export interface PreviewRow {
  row: number;
  num: string;
  label: string;
  cells: Record<
    'E' | 'F' | 'G' | 'H' | 'I' | 'J' | 'K' | 'L' | 'M' | 'N',
    string
  >;
  source: 'file' | 'app' | 'empty';
  added: boolean;
  visitId?: string;
}

export interface DayPreview {
  date: string;
  inTemplate: boolean;
  rows: PreviewRow[];
  warnings: string[];
}

export interface ReportCheck {
  fileName: string;
  placed: number;
  total: number;
  warnings: string[];
  /**
   * версия отчёта: меняется при любой правке визитов месяца, новом шаблоне,
   * новой сборке сервера; файл на телефоне хранится под ней
   */
  version: string | null;
}

/** Скачанный отчёт и версия, под которой его отдал сервер. */
export interface ReportFile {
  file: File;
  version: string | null;
}

export interface Invite {
  id: string;
  url?: string;
  createdAt?: string;
  expiresAt: string;
  usedAt?: string | null;
  usedBy?: { login: string; fullName: string } | null;
}

export interface PlanGroup {
  row: number;
  place: string;
  address: string;
  kind: VisitKind;
  /** строк в группе */
  capacity: number;
  /** занято: в файле + визиты из приложения */
  used: number;
  /** из плана в файле, а не открыта визитом не по плану */
  inFile: boolean;
}

export interface DayPlan {
  hasTemplate: boolean;
  /** есть ли этот день в шаблоне (выходных там нет) */
  inTemplate: boolean;
  groups: PlanGroup[];
}

/** Строка экрана «Справочник»: врач/провизор или аптека без провизора. */
export interface DirectoryEntry {
  type: 'contact' | 'place';
  id: string;
  fullName: string | null;
  specialty: string | null;
  phone: string | null;
  placeName: string | null;
  address: string | null;
  potential: Potential | null;
  hiddenFromBase: boolean;
  /** живых визитов */
  visits: number;
  lastVisit: string | null;
}

export interface DirectoryEntries {
  doctors: DirectoryEntry[];
  pharmacies: DirectoryEntry[];
}

/** Правка из экрана «Справочник»; пустая строка — стереть поле. */
export interface DirectoryEdit {
  fullName?: string;
  specialty?: string;
  phone?: string;
  placeName?: string;
  address?: string;
  potential?: Potential | null;
  hiddenFromBase?: boolean;
  /** исправить те же значения в визитах с этой даты (начало месяца) */
  fixVisitsFrom?: string;
}

export interface BaseStatus {
  /** файл «База врачей и аптек» от руководителя; null — ещё не загружен */
  template: { originalName: string; createdAt: string } | null;
  doctors: number;
  pharmacies: number;
  /** сколько повторов одного врача/провизора свели в одну строку */
  merged: number;
}

export interface BaseUploaded {
  originalName: string;
  createdAt: string;
  sheets: { doctors?: { sheet: string }; pharmacies?: { sheet: string } };
}
