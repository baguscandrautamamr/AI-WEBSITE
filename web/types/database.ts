export type Role = "admin" | "user_revit" | "viewer";
export type CommandType =
  | "electrical"
  | "export_pdf"
  | "export_dwg"
  | "import_pdf"
  | "import_excel"
  | "export_excel"
  | "get_sheets";
export type CommandStatus = "pending" | "in_progress" | "done" | "failed";

export interface Profile {
  id: string;
  full_name: string | null;
  role: Role;
  locale: "id" | "en";
  theme: "light" | "dark";
  created_at: string;
}

export interface RevitDevice {
  id: string;
  owner_admin: string | null;
  device_name: string;
  pairing_code: string;
  is_paired: boolean;
  last_seen_at: string | null;
  created_at: string;
}

export interface DeviceAccess {
  device_id: string;
  user_id: string;
  granted_by: string | null;
  granted_at: string;
}

export interface Command {
  id: string;
  device_id: string;
  requested_by: string;
  type: CommandType;
  payload: Record<string, unknown>;
  status: CommandStatus;
  created_at: string;
  updated_at: string;
}

export interface CommandResult {
  id: string;
  command_id: string;
  result: Record<string, unknown> | null;
  file_url: string | null;
  finished_at: string;
}

export interface ChatLog {
  id: string;
  user_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export interface FileRecord {
  id: string;
  user_id: string;
  device_id: string | null;
  command_id: string | null;
  kind: "pdf" | "dwg" | "xlsx";
  file_name: string | null;
  cloudinary_url: string;
  created_at: string;
}
