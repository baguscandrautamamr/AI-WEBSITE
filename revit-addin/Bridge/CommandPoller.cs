using System;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using Autodesk.Revit.UI;
using Newtonsoft.Json;

namespace ElectricalAddin.Bridge
{
    /// <summary>
    /// Polling tabel `commands` di Supabase tiap 1.5 detik. Dijalankan di
    /// background thread; setiap command yang ditemukan di-enqueue lalu
    /// memicu ExternalEvent supaya benar-benar dieksekusi di Revit API context.
    /// </summary>
    public class CommandPoller
    {
        private CancellationTokenSource? _cts;
        private SupabaseClient? _client;
        private string _deviceId = "";

        public void Start(UIControlledApplication app)
        {
            _cts = new CancellationTokenSource();

            string url = Environment.GetEnvironmentVariable("SUPABASE_URL") ?? "";
            string anonKey = Environment.GetEnvironmentVariable("SUPABASE_ANON_KEY") ?? "";
            string deviceToken = Environment.GetEnvironmentVariable("DEVICE_TOKEN") ?? "";
            _deviceId = LoadOrCreateDeviceId();
            _client = new SupabaseClient(url, anonKey, deviceToken);

            var executor = new CommandExecutor(_client);
            CommandExecutor.Event = ExternalEvent.Create(executor);

            Task.Run(async () =>
            {
                while (!_cts!.IsCancellationRequested)
                {
                    try
                    {
                        var pending = await _client.GetPendingCommandsAsync(_deviceId);
                        foreach (var cmd in pending)
                        {
                            await _client.MarkStatusAsync(cmd.Id, "in_progress");
                            CommandExecutor.Enqueue(cmd);
                        }
                        if (pending.Count > 0)
                            CommandExecutor.Event?.Raise();
                    }
                    catch
                    {
                        // TODO: tulis ke log file lokal supaya bisa didiagnosa kalau koneksi gagal
                    }

                    await Task.Delay(1500, _cts.Token);
                }
            }, _cts.Token);
        }

        public void Stop() => _cts?.Cancel();

        private string LoadOrCreateDeviceId()
        {
            string configPath = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                "ElectricalAddin", "device.json");

            if (File.Exists(configPath))
            {
                var cfg = JsonConvert.DeserializeObject<dynamic>(File.ReadAllText(configPath));
                return cfg?.deviceId ?? "";
            }

            // TODO: kalau file belum ada, tampilkan dialog untuk memasukkan
            // pairing code (dibuat admin di halaman /admin/devices), tukar
            // pairing code itu ke device_id + token lewat Edge Function,
            // lalu simpan hasilnya ke configPath.
            return Environment.GetEnvironmentVariable("DEVICE_ID") ?? "";
        }
    }
}
