using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Autodesk.Revit.DB;
using ClosedXML.Excel;

namespace ElectricalAddin.Revit
{
    public static class ExcelService
    {
        public static object ImportExcel(Document doc, Dictionary<string, object> payload)
        {
            string url = payload.TryGetValue("fileUrl", out var u) ? u?.ToString() ?? "" : "";

            // TODO: download file Excel dari `url` ke stream lokal, lalu buka
            // dengan ClosedXML dan mapping kolom -> parameter Revit sesuai
            // payload["columnMapping"].
            int updated = 0;
            return new { rowsProcessed = updated, status = "stub" };
        }

        public static (object, string?) ExportExcel(Document doc, Dictionary<string, object> payload)
        {
            using var wb = new XLWorkbook();
            var ws = wb.Worksheets.Add("Export");
            ws.Cell(1, 1).Value = "Element Id";
            ws.Cell(1, 2).Value = "Parameter";

            // TODO: isi baris sesuai kategori/parameter electrical yang diminta
            // di payload (misal semua circuit dengan load & voltage drop-nya).

            string path = Path.Combine(Path.GetTempPath(), $"export_{DateTime.Now:yyyyMMdd_HHmmss}.xlsx");
            wb.SaveAs(path);
            return (new { exported = Path.GetFileName(path) }, path);
        }
    }
}
