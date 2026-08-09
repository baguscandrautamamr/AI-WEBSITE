using System;
using System.Collections.Concurrent;
using Autodesk.Revit.UI;
using ElectricalAddin.Models;
using ElectricalAddin.Revit;

namespace ElectricalAddin.Bridge
{
    /// <summary>
    /// Semua pemanggilan Revit API HARUS lewat IExternalEventHandler ini —
    /// CommandPoller berjalan di background thread dan tidak boleh menyentuh
    /// Revit API secara langsung (akan crash / API context invalid).
    /// </summary>
    public class CommandExecutor : IExternalEventHandler
    {
        private static readonly ConcurrentQueue<CommandPayload> _queue = new();
        public static ExternalEvent? Event;

        private readonly SupabaseClient _client;

        public CommandExecutor(SupabaseClient client)
        {
            _client = client;
        }

        public static void Enqueue(CommandPayload cmd) => _queue.Enqueue(cmd);

        public void Execute(UIApplication app)
        {
            while (_queue.TryDequeue(out var cmd))
            {
                object result;
                string? fileUrl = null;
                bool failed = false;

                try
                {
                    var doc = app.ActiveUIDocument.Document;
                    switch (cmd.Type)
                    {
                        case "get_sheets":
                            result = ExportService.GetSheets(doc);
                            break;
                        case "export_pdf":
                            (result, fileUrl) = ExportService.ExportPdf(doc, cmd.Payload);
                            break;
                        case "export_dwg":
                            (result, fileUrl) = ExportService.ExportDwg(doc, cmd.Payload);
                            break;
                        case "import_pdf":
                            result = ExportService.ImportPdf(doc, cmd.Payload);
                            break;
                        case "import_excel":
                            result = ExcelService.ImportExcel(doc, cmd.Payload);
                            break;
                        case "export_excel":
                            (result, fileUrl) = ExcelService.ExportExcel(doc, cmd.Payload);
                            break;
                        case "electrical":
                            result = ElectricalCommands.Run(doc, cmd.Payload);
                            break;
                        default:
                            result = new { error = $"Unknown command type: {cmd.Type}" };
                            failed = true;
                            break;
                    }
                }
                catch (Exception ex)
                {
                    result = new { error = ex.Message };
                    failed = true;
                }

                _client.MarkStatusAsync(cmd.Id, failed ? "failed" : "done").Wait();
                _client.PostResultAsync(cmd.Id, result, fileUrl).Wait();

                // TODO: kalau fileUrl adalah path lokal (bukan URL Cloudinary),
                // upload dulu di sini sebelum PostResultAsync, lalu kirim URL
                // hasil upload, bukan path lokal.
            }
        }

        public string GetName() => "ElectricalAddin CommandExecutor";
    }
}
