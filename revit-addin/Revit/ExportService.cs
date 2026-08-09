using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Autodesk.Revit.DB;

namespace ElectricalAddin.Revit
{
    public static class ExportService
    {
        public static object GetSheets(Document doc)
        {
            var sheets = new FilteredElementCollector(doc)
                .OfClass(typeof(ViewSheet))
                .Cast<ViewSheet>()
                .Select(s => new { id = s.Id.IntegerValue, number = s.SheetNumber, name = s.Name })
                .ToList();
            return new { sheets };
        }

        public static (object, string?) ExportPdf(Document doc, Dictionary<string, object> payload)
        {
            var sheetIds = ((IEnumerable<object>)payload["sheetIds"])
                .Select(x => new ElementId(Convert.ToInt32(x)))
                .ToList();

            string quality = payload.TryGetValue("style", out var styleObj) &&
                              styleObj is Dictionary<string, object> style &&
                              style.TryGetValue("rasterQuality", out var q)
                ? q.ToString() ?? "High"
                : "High";

            var options = new PDFExportOptions
            {
                Combine = true,
                RasterQuality = Enum.TryParse<RasterQualityType>(quality, out var rq) ? rq : RasterQualityType.High,
            };

            string outputFolder = Path.GetTempPath();
            string fileName = $"export_{DateTime.Now:yyyyMMdd_HHmmss}.pdf";
            doc.Export(outputFolder, fileName, sheetIds, options);

            // TODO: upload localPath ke Cloudinary lewat HTTP request (atau
            // panggil balik endpoint /api di website yang menerima upload),
            // lalu kembalikan URL Cloudinary sebagai fileUrl, bukan path lokal.
            string localPath = Path.Combine(outputFolder, fileName);
            return (new { exported = fileName }, localPath);
        }

        public static (object, string?) ExportDwg(Document doc, Dictionary<string, object> payload)
        {
            var sheetIds = ((IEnumerable<object>)payload["sheetIds"])
                .Select(x => new ElementId(Convert.ToInt32(x)))
                .ToList();

            var options = new DWGExportOptions();
            if (payload.TryGetValue("exportSetupName", out var setupObj))
            {
                string setupName = setupObj?.ToString() ?? "";
                var predefined = DWGExportOptions.GetPredefinedSetups(doc, ExportUnit.Default);
                if (!string.IsNullOrEmpty(setupName) && predefined.Contains(setupName))
                    options = DWGExportOptions.GetPredefinedOptions(doc, setupName);
            }

            string outputFolder = Path.GetTempPath();
            string fileName = $"export_{DateTime.Now:yyyyMMdd_HHmmss}.dwg";
            doc.Export(outputFolder, fileName, sheetIds, options);

            string localPath = Path.Combine(outputFolder, fileName);
            return (new { exported = fileName }, localPath);
        }

        public static object ImportPdf(Document doc, Dictionary<string, object> payload)
        {
            string url = payload.TryGetValue("fileUrl", out var u) ? u?.ToString() ?? "" : "";
            // TODO: download file dari `url` ke temp folder, lalu import
            // sebagai PDF underlay memakai ImportPDFDialog API (Revit 2024+)
            // atau sebagai raster image link, sesuai kebutuhan project.
            return new { imported = url, status = "stub" };
        }
    }
}
