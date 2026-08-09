using System.Windows;

namespace ElectricalAddin.App
{
    /// <summary>
    /// UI add-in me-render web app YANG SAMA dengan website (bukan UI
    /// terpisah) lewat WebView2 — supaya tampilannya konsisten dan cukup
    /// dirawat satu codebase saja. Kalau butuh mode "embedded" khusus (tanpa
    /// sidebar penuh, cocok untuk panel sempit), buat route /embedded/*
    /// di Next.js yang reuse komponen React yang sama dengan layout minimal.
    ///
    /// Catatan dari riset: WebView2 pernah punya konflik saat ditanam
    /// langsung di Dockable Panel Revit — lebih stabil dipakai sebagai
    /// popup Window biasa seperti di bawah ini. Kalau nanti mau coba
    /// Dockable Panel asli, uji dulu di environment non-produksi.
    /// </summary>
    public partial class DockablePanelUI : Window
    {
        private static DockablePanelUI? _instance;

        public DockablePanelUI()
        {
            InitializeComponent();
            Loaded += async (s, e) =>
            {
                await WebView.EnsureCoreWebView2Async(null);
                WebView.CoreWebView2.Navigate("https://your-domain.vercel.app/embedded/electrical");
                // TODO: kalau perlu komunikasi dua arah langsung (bukan lewat
                // Supabase command bus), pakai WebView.CoreWebView2.WebMessageReceived
                // dan window.chrome.webview.postMessage(...) di sisi JS.
            };
        }

        public static void ShowOrFocus()
        {
            if (_instance == null || !_instance.IsLoaded)
            {
                _instance = new DockablePanelUI();
                _instance.Show();
            }
            else
            {
                _instance.Activate();
            }
        }
    }
}
