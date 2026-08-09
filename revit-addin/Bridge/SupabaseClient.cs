using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading.Tasks;
using ElectricalAddin.Models;

namespace ElectricalAddin.Bridge
{
    /// <summary>
    /// Wrapper tipis di atas PostgREST (REST API bawaan Supabase).
    ///
    /// CATATAN KEAMANAN — INI BARU CONTOH DASAR:
    /// Memakai anon key + token statis per device belum cukup aman untuk
    /// production. Idealnya setiap device punya JWT bertanda tangan yang
    /// dikeluarkan lewat Supabase Edge Function saat pairing (dengan pairing
    /// code), supaya RLS bisa memvalidasi identitas device secara kriptografis,
    /// bukan cuma percaya device_id yang dikirim dari client.
    /// </summary>
    public class SupabaseClient
    {
        private readonly HttpClient _http;
        private readonly string _url;

        public SupabaseClient(string url, string anonKey, string deviceToken)
        {
            _url = url.TrimEnd('/');
            _http = new HttpClient();
            _http.DefaultRequestHeaders.Add("apikey", anonKey);
            _http.DefaultRequestHeaders.Add("Authorization", $"Bearer {deviceToken}");
        }

        public async Task<List<CommandPayload>> GetPendingCommandsAsync(string deviceId)
        {
            var resp = await _http.GetAsync(
                $"{_url}/rest/v1/commands?device_id=eq.{deviceId}&status=eq.pending&select=*");
            resp.EnsureSuccessStatusCode();
            var json = await resp.Content.ReadAsStringAsync();
            return JsonSerializer.Deserialize<List<CommandPayload>>(
                json, new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? new();
        }

        public async Task MarkStatusAsync(string commandId, string status)
        {
            var req = new HttpRequestMessage(HttpMethod.Patch, $"{_url}/rest/v1/commands?id=eq.{commandId}")
            {
                Content = JsonContent.Create(new { status })
            };
            req.Headers.Add("Prefer", "return=minimal");
            await _http.SendAsync(req);
        }

        public async Task PostResultAsync(string commandId, object result, string? fileUrl)
        {
            var req = new HttpRequestMessage(HttpMethod.Post, $"{_url}/rest/v1/command_results")
            {
                Content = JsonContent.Create(new { command_id = commandId, result, file_url = fileUrl })
            };
            req.Headers.Add("Prefer", "return=minimal");
            await _http.SendAsync(req);
        }
    }
}
