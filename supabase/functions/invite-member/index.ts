import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !anon || !service) return json({ error: "Konfigurasi secret Edge Function belum lengkap." }, 500);
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Login dibutuhkan." }, 401);
  const callerClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false, autoRefreshToken: false } });
  const adminClient = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: userData, error: userError } = await callerClient.auth.getUser();
  if (userError || !userData.user) return json({ error: "Sesi login tidak valid." }, 401);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Body JSON tidak valid." }, 400); }
  const { data: memberships, error: memberError } = await adminClient.from("business_members")
    .select("business_id,role").eq("user_id", userData.user.id).eq("is_active", true).limit(1);
  if (memberError) return json({ error: "Gagal memeriksa akses usaha." }, 500);
  const callerMembership = memberships?.[0];
  if (!callerMembership || !["owner", "admin"].includes(callerMembership.role)) return json({ error: "Hanya Pemilik/Admin yang boleh mengelola pengguna." }, 403);
  const businessId = callerMembership.business_id as string;
  const callerRole = callerMembership.role as string;
  const action = String(body.action ?? "");
  if (action === "list") {
    const { data, error } = await adminClient.from("business_members")
      .select("user_id,role,is_active,business_member_profiles(email,display_name)")
      .eq("business_id", businessId).order("created_at", { ascending: true });
    if (error) return json({ error: "Gagal membaca daftar pengguna." }, 500);
    const members = await Promise.all((data ?? []).map(async (m: any) => {
      const { data: authData } = await adminClient.auth.admin.getUserById(m.user_id);
      return {
        user_id: m.user_id,
        role: m.role,
        is_active: m.is_active,
        email: m.business_member_profiles?.[0]?.email ?? authData.user?.email ?? "",
        display_name: m.business_member_profiles?.[0]?.display_name ?? "",
        email_confirmed: Boolean(authData.user?.email_confirmed_at),
        invited_at: authData.user?.invited_at ?? null,
        last_sign_in_at: authData.user?.last_sign_in_at ?? null,
      };
    }));
    return json({ members });
  }
  const appUrl = Deno.env.get("APP_SITE_URL") ?? "https://ps-nawfal5.vercel.app";
  if (action === "resend") {
    if (callerRole !== "owner") return json({ error: "Hanya Pemilik yang boleh mengirim ulang undangan." }, 403);
    const targetId = String(body.user_id ?? "");
    if (!targetId) return json({ error: "user_id wajib diisi." }, 400);
    const { data: membership, error: membershipError } = await adminClient.from("business_members")
      .select("business_id,user_id,role,is_active,business_member_profiles(email,display_name)")
      .eq("business_id", businessId).eq("user_id", targetId).maybeSingle();
    if (membershipError || !membership) return json({ error: "Anggota tidak ditemukan." }, 404);
    const { data: targetData, error: targetError } = await adminClient.auth.admin.getUserById(targetId);
    const target = targetData?.user;
    if (targetError || !target?.email) return json({ error: "Akun undangan tidak ditemukan." }, 404);
    if (target.email_confirmed_at || target.last_sign_in_at || !target.invited_at) {
      return json({ error: "Akun ini sudah tidak berstatus undangan pending. Gunakan pemulihan password jika pengguna kehilangan akses." }, 409);
    }
    const profile = membership.business_member_profiles?.[0] ?? {};
    const previousRole = membership.role as string;
    const wasActive = Boolean(membership.is_active);
    const email = target.email;
    const { error: deleteError } = await adminClient.auth.admin.deleteUser(targetId);
    if (deleteError) return json({ error: "Undangan lama tidak bisa diperbarui: " + deleteError.message }, 500);
    const { data: reinvited, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
      redirectTo: appUrl,
      data: { full_name: profile.display_name ?? "" },
    });
    if (inviteError || !reinvited.user) {
      return json({ error: "Akun pending lama sudah dibersihkan tetapi undangan baru gagal dikirim. Periksa Auth URL Configuration dan SMTP, lalu undang email ini kembali. " + (inviteError?.message ?? ""), recovery_needed: true }, 500);
    }
    const { error: membershipUpsertError } = await adminClient.from("business_members").upsert({
      business_id: businessId, user_id: reinvited.user.id, role: previousRole, is_active: wasActive,
    }, { onConflict: "business_id,user_id" });
    if (membershipUpsertError) return json({ error: "Email terkirim tetapi role usaha gagal dipulihkan: " + membershipUpsertError.message }, 500);
    const { error: profileUpsertError } = await adminClient.from("business_member_profiles").upsert({
      business_id: businessId, user_id: reinvited.user.id, email, display_name: profile.display_name ?? "",
    }, { onConflict: "business_id,user_id" });
    if (profileUpsertError) return json({ error: "Undangan terkirim tetapi profil gagal dipulihkan: " + profileUpsertError.message }, 500);
    await adminClient.from("audit_logs").insert({
      business_id: businessId, user_id: userData.user.id, action: "member.invite_resent",
      entity: "business_member", entity_id: reinvited.user.id,
      before_data: { previous_user_id: targetId, email, role: previousRole },
      after_data: { user_id: reinvited.user.id, email, role: previousRole },
    });
    return json({ ok: true, message: "Undangan baru dikirim ke " + email + ".", user_id: reinvited.user.id });
  }
  if (action === "invite") {
    const email = String(body.email ?? "").trim().toLowerCase();
    const role = String(body.role ?? "operator");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Alamat email tidak valid." }, 400);
    if (!["admin", "operator"].includes(role)) return json({ error: "Role undangan tidak valid." }, 400);
    if (role === "admin" && callerRole !== "owner") return json({ error: "Hanya Pemilik yang boleh mengundang Admin." }, 403);
    const { data: invited, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, { redirectTo: appUrl });
    if (inviteError || !invited.user) return json({ error: inviteError?.message ?? "Undangan gagal dikirim." }, 400);
    const { error: upsertError } = await adminClient.from("business_members")
      .upsert({ business_id: businessId, user_id: invited.user.id, role, is_active: true }, { onConflict: "business_id,user_id" });
    if (upsertError) return json({ error: "Akun diundang, tetapi membership gagal disimpan: " + upsertError.message }, 500);
    const { error: profileError } = await adminClient.from("business_member_profiles")
      .upsert({ business_id: businessId, user_id: invited.user.id, email, display_name: String(body.display_name ?? "") }, { onConflict: "business_id,user_id" });
    if (profileError) return json({ error: "Anggota tersimpan, profil gagal disimpan: " + profileError.message }, 500);
    await adminClient.from("audit_logs").insert({ business_id: businessId, user_id: userData.user.id, action: "member.invited", entity: "business_member", after_data: { email, role } });
    return json({ ok: true, message: "Undangan email berhasil dikirim." });
  }
  if (action === "set_role" || action === "set_active") {
    const targetId = String(body.user_id ?? "");
    if (!targetId) return json({ error: "user_id wajib diisi." }, 400);
    if (targetId === userData.user.id) return json({ error: "Anda tidak dapat mengubah role/status akun sendiri." }, 400);
    const { data: target, error: targetError } = await adminClient.from("business_members").select("role,is_active")
      .eq("business_id", businessId).eq("user_id", targetId).maybeSingle();
    if (targetError || !target) return json({ error: "Anggota tidak ditemukan." }, 404);
    if (target.role === "owner") return json({ error: "Role Pemilik tidak dapat diubah melalui menu ini." }, 403);
    if (action === "set_role") {
      const role = String(body.role ?? "");
      if (!["admin", "operator"].includes(role)) return json({ error: "Role tidak valid." }, 400);
      if (callerRole !== "owner" && (target.role === "admin" || role === "admin")) return json({ error: "Hanya Pemilik yang boleh mengubah role Admin." }, 403);
      const { error } = await adminClient.from("business_members").update({ role }).eq("business_id", businessId).eq("user_id", targetId);
      if (error) return json({ error: error.message }, 500);
      await adminClient.from("audit_logs").insert({ business_id: businessId, user_id: userData.user.id, action: "member.role_changed", entity: "business_member", entity_id: targetId, before_data: { role: target.role }, after_data: { role } });
      return json({ ok: true });
    }
    const isActive = Boolean(body.is_active);
    const { error } = await adminClient.from("business_members").update({ is_active: isActive }).eq("business_id", businessId).eq("user_id", targetId);
    if (error) return json({ error: error.message }, 500);
    await adminClient.from("audit_logs").insert({ business_id: businessId, user_id: userData.user.id, action: isActive ? "member.activated" : "member.deactivated", entity: "business_member", entity_id: targetId, before_data: { is_active: target.is_active }, after_data: { is_active: isActive } });
    return json({ ok: true });
  }
  return json({ error: "Action tidak didukung." }, 400);
});
