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
  templateRow: number | null;
  /** уже записан в файле шаблона — только просмотр */
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
