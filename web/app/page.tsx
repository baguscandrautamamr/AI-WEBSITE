import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Route "/" tidak punya halaman sendiri — semua konten ada di grup (dashboard)
// dan (auth), yang tidak menambah segmen URL. Tanpa file ini `/` tidak ada
// sama sekali dan Vercel membalas 404 di root domain.
export default async function RootPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  redirect(user ? "/electrical" : "/login");
}
