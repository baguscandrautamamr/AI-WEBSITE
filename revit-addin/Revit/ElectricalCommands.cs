using System;
using System.Collections.Generic;
using Autodesk.Revit.DB;

namespace ElectricalAddin.Revit
{
    /// <summary>
    /// TODO PENTING: isi ulang class ini sesuai command asli dari bot Telegram
    /// (electrical_ai). Routing keyword-matching di bawah ini HANYA placeholder
    /// starter — pada implementasi final, "text" seharusnya sudah diubah jadi
    /// action + parameter terstruktur oleh LLM (tool-calling) di sisi website,
    /// sebelum dikirim ke sini. Add-in idealnya tidak perlu menebak-nebak intent
    /// dari teks mentah.
    /// </summary>
    public static class ElectricalCommands
    {
        public static object Run(Document doc, Dictionary<string, object> payload)
        {
            string text = payload.TryGetValue("text", out var t) ? t?.ToString() ?? "" : "";

            if (text.Contains("panel", StringComparison.OrdinalIgnoreCase))
                return GeneratePanelSchedule(doc);
            if (text.Contains("voltage drop", StringComparison.OrdinalIgnoreCase))
                return CalculateVoltageDrop(doc);
            if (text.Contains("tag", StringComparison.OrdinalIgnoreCase))
                return TagCircuits(doc);

            return new { message = "Command electrical belum dikenali — tambahkan handler-nya di ElectricalCommands.cs" };
        }

        private static object GeneratePanelSchedule(Document doc)
        {
            using var tx = new Transaction(doc, "Generate Panel Schedule");
            tx.Start();
            // TODO: ambil semua ElectricalSystem / panel schedule di project,
            // sesuaikan dengan logika asli dari bot Telegram.
            tx.Commit();
            return new { action = "generate_panel_schedule", status = "stub" };
        }

        private static object CalculateVoltageDrop(Document doc)
        {
            // TODO: iterasi ElectricalCircuit, hitung voltage drop berdasarkan
            // panjang kabel, jenis konduktor, dan load — sesuaikan rumus/standar
            // yang dipakai bot Telegram (SNI/PUIL/IEC/NEC).
            return new { action = "calculate_voltage_drop", status = "stub" };
        }

        private static object TagCircuits(Document doc)
        {
            using var tx = new Transaction(doc, "Tag Circuits");
            tx.Start();
            // TODO: buat tag untuk semua electrical circuit di view aktif
            tx.Commit();
            return new { action = "tag_circuits", status = "stub" };
        }
    }
}
