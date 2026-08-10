"use client";

import { useI18n } from "@/lib/i18n";

/**
 * Hasil perintah, dibaca manusia.
 *
 * Sebelumnya isinya dituang apa adanya sebagai JSON — kurung, koma, tanda
 * kutip, dan nama field bergaris bawah. Itu bisa dibaca oleh yang menulis
 * add-in, dan tidak oleh yang memakai gambarnya.
 *
 * Ditulis generik, bukan satu tampilan per jenis hasil. Setiap handler add-in
 * mengembalikan bentuknya sendiri dan bentuk itu berubah seiring waktu; kalau
 * di sini ada daftar field yang dikenali, hasil dari perintah yang baru
 * ditambahkan akan berhenti tampil sampai file ini menyusul. Yang dilakukan
 * malah menerjemahkan bentuknya: daftar objek jadi tabel, objek jadi pasangan
 * label dan nilai, URL jadi tautan unduhan.
 *
 * Nama field diterjemahkan lewat `result.*` kalau ada padanannya, dan dirapikan
 * apa adanya kalau tidak — jadi field baru dari add-in tetap terbaca, hanya
 * belum berbahasa Indonesia.
 */

/** Sedalam apa penyarangan masih digambar sebelum menyerah ke teks biasa. */
const MAX_DEPTH = 4;

export default function ResultView({ value }: { value: unknown }) {
  if (value == null) return null;
  return <Node value={value} depth={0} />;
}

function Node({ value, depth }: { value: unknown; depth: number }) {
  const { t } = useI18n();

  if (value == null || value === "") return null;

  if (typeof value === "boolean") {
    return <span>{value ? t("result.yes") : t("result.no")}</span>;
  }

  if (typeof value === "number") return <span>{value.toLocaleString()}</span>;

  if (typeof value === "string") return <Scalar value={value} />;

  if (depth >= MAX_DEPTH) {
    return <code className="text-xs break-all">{JSON.stringify(value)}</code>;
  }

  if (Array.isArray(value)) return <List items={value} depth={depth} />;

  if (typeof value === "object") {
    return <Fields object={value as Record<string, unknown>} depth={depth} />;
  }

  return <span>{String(value)}</span>;
}

/** Teks biasa, kecuali kalau ia sebenarnya sebuah file yang bisa diunduh. */
function Scalar({ value }: { value: string }) {
  const { t } = useI18n();

  if (!/^https?:\/\//i.test(value)) return <span className="break-words">{value}</span>;

  let name = value;
  try {
    name = decodeURIComponent(new URL(value).pathname.split("/").pop() || value);
  } catch {
    // Bukan URL yang bisa di-parse walau diawali http — tampilkan apa adanya.
  }

  return (
    <a
      href={value}
      target="_blank"
      rel="noreferrer"
      className="text-accent underline break-all"
      title={t("result.download")}
    >
      ↓ {name}
    </a>
  );
}

function List({ items, depth }: { items: unknown[]; depth: number }) {
  const { t } = useI18n();

  if (items.length === 0) return <span className="opacity-55">{t("result.empty")}</span>;

  // Daftar objek adalah tabel. Itu bentuk yang sama dengan yang dilihat orang
  // di Revit — sheet, perangkat, baris schedule — jadi digambar sebagai tabel.
  const rows = items.filter(
    (item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === "object" && !Array.isArray(item)
  );

  if (rows.length === items.length && rows.length > 0 && depth < MAX_DEPTH - 1) {
    const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))].filter((key) =>
      rows.some((row) => row[key] != null && row[key] !== "")
    );

    if (columns.length > 0 && columns.length <= 8) {
      return <Table rows={rows} columns={columns} depth={depth} />;
    }
  }

  return (
    <ul className="list-disc space-y-0.5 pl-5">
      {items.map((item, i) => (
        <li key={i}>
          <Node value={item} depth={depth + 1} />
        </li>
      ))}
    </ul>
  );
}

function Table({
  rows,
  columns,
  depth,
}: {
  rows: Record<string, unknown>[];
  columns: string[];
  depth: number;
}) {
  return (
    // Tabel lebar menggulir di dalam kotaknya sendiri; halaman tidak ikut
    // bergeser ke samping, yang di HP membuat seluruh layout terasa rusak.
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left opacity-60">
            {columns.map((key) => (
              <th key={key} className="pb-1 pr-4 font-medium">
                <Label field={key} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="align-top">
              {columns.map((key) => (
                <td key={key} className="py-0.5 pr-4">
                  <Node value={row[key]} depth={depth + 2} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Fields({ object, depth }: { object: Record<string, unknown>; depth: number }) {
  // `kind` adalah penanda jenis hasil untuk kode, bukan sesuatu yang berarti
  // bagi yang membacanya.
  const entries = Object.entries(object).filter(
    ([key, value]) =>
      key !== "kind" &&
      value != null &&
      value !== "" &&
      !(Array.isArray(value) && value.length === 0)
  );

  if (entries.length === 0) return null;

  return (
    <div className="space-y-1">
      {entries.map(([key, value]) => (
        <div key={key} className="flex flex-wrap gap-x-2 gap-y-0.5">
          <span className="opacity-60">
            <Label field={key} />
          </span>
          <span className="min-w-0 flex-1">
            <Node value={value} depth={depth + 1} />
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Nama field sebagaimana dibaca orang.
 *
 * `t()` mengembalikan kuncinya sendiri kalau tidak ada padanan, dan itu dipakai
 * sebagai penanda: field yang belum diterjemahkan dirapikan dari bentuk
 * snake_case-nya, bukan ditampilkan sebagai "result.devices_removed".
 */
function Label({ field }: { field: string }) {
  const { t } = useI18n();
  const key = `result.${field}`;
  const translated = t(key);
  return <>{translated === key ? humanize(field) : translated}</>;
}

function humanize(field: string) {
  const words = field.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
