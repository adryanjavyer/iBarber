/** Supabase Edge Function para lembretes 24h antes (WhatsApp Business Cloud API).
 * Deploy com secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, WHATSAPP_ACCESS_TOKEN,
 * WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_TEMPLATE_NAME, IBARBER_CRON_SECRET.
 * Agende uma invocação horária pelo Supabase Cron/Edge Functions.
 * Template aprovado na Meta: idioma pt_BR com três placeholders:
 * {{1}} nome, {{2}} data DD/MM/AAAA, {{3}} horário HH:MM.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async request => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const expected = Deno.env.get("IBARBER_CRON_SECRET");
  if (!expected || request.headers.get("x-ibarber-cron-secret") !== expected) {
    return new Response("Unauthorized", { status: 401 });
  }
  const env = (name: string) => Deno.env.get(name) || "";
  const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
  const now = new Date();
  const start = new Date(now.getTime() + 23 * 60 * 60 * 1000);
  const end = new Date(now.getTime() + 25 * 60 * 60 * 1000);
  const todaySaoPaulo = new Intl.DateTimeFormat("en-CA", {timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"}).format(now);
  const tomorrow = new Date(`${todaySaoPaulo}T12:00:00-03:00`);
  tomorrow.setDate(tomorrow.getDate()+1);
  const dates = [todaySaoPaulo,tomorrow.toISOString().slice(0,10)];
  const { data: bookings, error } = await db.from("dk_bookings")
    .select("id,booking_data,booking_date_iso,booking_time,status")
    .in("booking_date_iso",dates).in("status",["Pendente","Confirmado"]);
  if (error) return Response.json({error:error.message},{status:500});
  let sent=0, skipped=0, errors=0;
  for (const booking of bookings || []) {
    const info = booking.booking_data || {};
    if (!info.reminderConsent) {skipped++;continue;}
    const when = new Date(`${booking.booking_date_iso}T${String(booking.booking_time||"").split(" - ")[0]}:00-03:00`);
    if (when < start || when > end) {skipped++;continue;}
    const {data:existing}=await db.from("ibarber_reminder_log").select("booking_id").eq("booking_id",booking.id).eq("reminder_type","24h").maybeSingle();
    if(existing){skipped++;continue;}
    const phone=String(info.clientPhone||"").replace(/\D/g,"");
    if(!phone){skipped++;continue;}
    const to=phone.startsWith("55")?phone:`55${phone}`;
    const response=await fetch(`https://graph.facebook.com/v23.0/${env("WHATSAPP_PHONE_NUMBER_ID")}/messages`, {
      method:"POST",headers:{Authorization:`Bearer ${env("WHATSAPP_ACCESS_TOKEN")}`,"Content-Type":"application/json"},
      body:JSON.stringify({messaging_product:"whatsapp",to,type:"template",template:{
        name:env("WHATSAPP_TEMPLATE_NAME"),language:{code:"pt_BR"},components:[{type:"body",parameters:[
          {type:"text",text:String(info.clientName||"Cliente").slice(0,100)},
          {type:"text",text:String(booking.booking_date_iso).split("-").reverse().join("/")},
          {type:"text",text:String(booking.booking_time).split(" - ")[0]},
        ]}],
      }}),
    });
    if (response.ok) {
      const {error: logError}=await db.from("ibarber_reminder_log").insert({booking_id:booking.id,reminder_type:"24h"});
      if(logError)errors++;else sent++;
    } else {errors++;console.error("WhatsApp reminder failed",booking.id,response.status,await response.text());}
  }
  return Response.json({sent,skipped,errors});
});
