/* iBarber Pro — módulos complementares. Sem credenciais privadas no navegador. */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
  const currency = value => new Intl.NumberFormat("pt-BR", {style:"currency",currency:"BRL"}).format(Number(value)||0);
  const el = (tag, props = {}) => Object.assign(document.createElement(tag), props);
  const client = () => getAdminSupabaseClient();
  const receiptsKey = "ibarber_my_reservations_v2";
  const weekdays = ["Domingo","Segunda","Terça","Quarta","Quinta","Sexta","Sábado"];
  const adminData = { blocks: [], barberHours: [], finance: [], staff: [], settings: null };
  let activeBarberHours = [];
  let visibleReceipts = [];
  let isLoadingAdmin = false;
  let savingReservation = false;
  const toast = message => {
    const node = $("ibarberToast"); if (!node) return;
    node.textContent = message;
    node.classList.add("visible");
    clearTimeout(toast.timeout);
    toast.timeout = setTimeout(() => node.classList.remove("visible"), 4500);
  };
  function readReceipts() {
    try {
      const stored=JSON.parse(localStorage.getItem(receiptsKey) || "[]").filter(x=>x?.id && x?.secret);
      const combined=[...(window.ibarberReceiptMemory||[]),...stored];
      return [...new Map(combined.map(x=>[x.id,x])).values()];
    } catch { return (window.ibarberReceiptMemory||[]).filter(x=>x?.id && x?.secret); }
  }
  function saveReceipts(items) {
    window.ibarberReceiptMemory=items.slice(0,30);
    try {localStorage.setItem(receiptsKey,JSON.stringify(items.slice(0,30)));} catch {toast("Seu navegador não permite salvar comprovantes permanentemente.");}
  }
  const feedback = (id, message) => { if ($(id)) $(id).textContent = message || ""; };
  async function rpc(name, args) {
    if (!client()) throw new Error("O servidor não está configurado.");
    const { data,error } = await client().rpc(name,args);
    if (error) throw Error(error.message || "Falha de comunicação.");
    return data;
  }
  async function query(table, operation = fn => fn.select("*")) {
    if (!client()) throw new Error("Servidor indisponível.");
    const {data,error} = await operation(client().from(table));
    if (error) throw Error(error.message);
    return data;
  }
  function toTime(minutes) {return `${String(Math.floor(minutes/60)).padStart(2,"0")}:${String(minutes%60).padStart(2,"0")}`;}
  function parseTime(time) {const [h,m]=String(time||"0:0").split(":").map(Number);return h*60+m;}
  function today() {return toISODate(new Date());}
  const busyRefresh = () => { if (typeof loadPublicBusySlots === "function") loadPublicBusySlots(); };
  const bookingSecret = id => readReceipts().find(item=>item.id===id)?.secret;
  function storeReceipt(receipt) {
    const prev = readReceipts().filter(x=>x.id!==receipt.id);
    saveReceipts([receipt,...prev]);
  }

  function updateOpenStatus() {
    const date=new Date(), minutes=date.getHours()*60+date.getMinutes();
    const periods = getBusinessHoursForDate(date, state.professionalId);
    const open = periods.some(p => minutes>=parseTime(p.start) && minutes<parseTime(p.end));
    $("liveOpenStatus").textContent=open?"Aberto agora":"Fechado agora";
    $("liveOpenStatus").classList.toggle("closed", !open);
  }
  function reflectShopSettings(settings) {
    if (!settings) return;
    adminData.settings=settings;
    BARBERSHOP.whatsappNumber=String(settings.whatsapp||"").replace(/\D/g,"");
    BARBERSHOP.city=settings.city||BARBERSHOP.city;
    if (settings.shop_name) {
      document.title = `iBarber | ${settings.shop_name}`;
      const h=document.querySelector(".hero-copy .hero-text");
      if (h) h.textContent = `Escolha seu profissional, selecione o serviço e reserve com ${settings.shop_name}.`;
    }
    if (settings.address) document.querySelectorAll(".location-line").forEach(n=>n.textContent=settings.address);
    const ig=$("instagramFooter"), wa=$("whatsappFooter");
    if (ig) {ig.href=settings.instagram||"#";ig.hidden=!/^https:\/\//.test(settings.instagram||"");}
    if (wa) {wa.href=BARBERSHOP.whatsappNumber?`https://wa.me/${BARBERSHOP.whatsappNumber}`:"#";wa.hidden=!BARBERSHOP.whatsappNumber;}
    if ($("shopName")) $("shopName").value=settings.shop_name||"";
    if ($("shopWhatsapp")) $("shopWhatsapp").value=settings.whatsapp||"";
    if ($("shopInstagram")) $("shopInstagram").value=settings.instagram||"";
    if ($("shopAddress")) $("shopAddress").value=settings.address||"";
    if ($("shopCity")) $("shopCity").value=settings.city||"";
    Object.entries(settings.business_hours||{}).forEach(([key,hours])=> {
      BUSINESS_HOURS_BY_WEEKDAY[Number(key)] = Array.isArray(hours)?hours:[];
    });
    updateOpenStatus(); renderDays(); renderTimes(); updateWhatsAppLinks();
  }
  window.ibarberGetPeriods = (professionalId,day) => {
    if (day===undefined || day===null) return null;
    const found=activeBarberHours.find(h=>h.professional_id===professionalId && Number(h.weekday)===Number(day));
    return found ? found.periods : null;
  };
  window.ibarberIsSlotBlocked = (date,professional,range) => adminData.blocks.some(b=>
    b.block_date===date && (!b.professional_id || b.professional_id===professional) &&
    (!b.start_time || (parseTime(b.start_time)<parseTime(getTimeEnd(range)) && parseTime(b.end_time)>parseTime(getTimeStart(range))))
  );
  async function loadPublicConfiguration() {
    if (!client()) {toast("Configure o Supabase para habilitar reservas.");return;}
    const [settingsResponse,servicesResponse,hoursResponse,statsResponse] = await Promise.allSettled([
      query("ibarber_settings",q=>q.select("*").eq("id",1).maybeSingle()),
      query("ibarber_services",q=>q.select("*").eq("active",true).order("sort_order")),
      query("ibarber_barber_hours",q=>q.select("professional_id,weekday,periods")),
      rpc("ibarber_public_stats",{}),
    ]);
    if (settingsResponse.status==="fulfilled") reflectShopSettings(settingsResponse.value);
    if (hoursResponse.status==="fulfilled") activeBarberHours=hoursResponse.value||[];
    if (servicesResponse.status==="fulfilled") {
      const list=servicesResponse.value||[];
      services=list.map(row=>({id:row.id,name:row.name,price:currency(row.price),
        durationMinutes:row.duration_min,duration:`${row.duration_min} min`,image:row.image||"assets/service-default.svg", active:true}));
      if (!services.some(x=>x.id===state.serviceId)) state.serviceId=services[0]?.id||"";
      renderServices(); renderTimes(); updateUI();
      $("liveBaseDuration").textContent=services.length ? `${services[0].durationMinutes}min` : "—";
    }
    if (statsResponse.status==="fulfilled") {
      const stats=statsResponse.value||{};
      $("liveReviewRating").textContent=stats.rating===null||stats.rating===undefined?"—":String(stats.rating);
      $("liveCustomerCount").textContent=Number(stats.completed)>0?String(stats.completed):"—";
    }
    if (servicesResponse.status!=="fulfilled") toast("Execute o SQL do iBarber no Supabase para ativar o catálogo.");
    updateOpenStatus(); renderDays(); busyRefresh();
  }

  function showModal(id) {const node=$(id);if (!node)return;node.hidden=false;node.setAttribute("aria-hidden","false");document.body.classList.add("pro-modal-open");}
  function hideModal(id) {const node=$(id);if (!node)return;node.hidden=true;node.setAttribute("aria-hidden","true");document.body.classList.remove("pro-modal-open");}
  window.ibarberOpenMyBookings = async () => {showModal("myReservationsModal");await renderMyBookings();};
  async function renderMyBookings() {
    const root=$("myBookingsList");root.textContent="Carregando reservas...";
    const receipts=readReceipts();
    if (!receipts.length) {root.innerHTML='<div class="pro-empty">Nenhuma reserva salva neste dispositivo.</div>';return;}
    const details=await Promise.all(receipts.map(async receipt=>{
      try {const booking=await rpc("ibarber_manage_booking",{p_id:receipt.id,p_secret:receipt.secret,p_action:"view"});return {receipt,booking};}
      catch(error){return {receipt,error:error.message};}
    }));
    visibleReceipts=details;
    root.innerHTML=details.map(({receipt,booking,error})=>{
      if(error) return `<article class="pro-row"><strong>${esc(receipt.id)}</strong><p>${esc(error)}</p><button class="ghost-button" data-my-action="forget" data-id="${esc(receipt.id)}">Remover deste aparelho</button></article>`;
      const future = booking.status!=="Cancelado" && booking.status!=="Concluído" &&
        new Date(`${booking.bookingDateIso}T${getTimeStart(booking.time)}`).getTime() > Date.now();
      const completed=booking.status==="Concluído";
      return `<article class="pro-row">
        <div class="pro-row-title"><strong>${esc(booking.serviceName)}</strong><span>${esc(booking.status)}</span></div>
        <p>${esc(booking.bookingDateIso)} · ${esc(booking.time)} · ${esc(booking.professionalName)}</p>
        <p>Reserva ${esc(booking.id)} · ${esc(booking.clientName)}</p>
        <div class="pro-inline-actions">
          <button class="ghost-button" data-my-action="copy" data-id="${esc(booking.id)}">Copiar chave</button>
          <button class="ghost-button" data-my-action="calendar" data-id="${esc(booking.id)}">Calendário</button>
          ${future?`<button class="ghost-button" data-my-action="reschedule" data-id="${esc(booking.id)}">Reagendar</button><button class="ghost-button danger" data-my-action="cancel" data-id="${esc(booking.id)}">Cancelar</button>`:""}
          ${completed?`<button class="ghost-button" data-my-action="rate" data-id="${esc(booking.id)}">Avaliar</button>`:""}
        </div><div class="pro-inner-form" id="myForm-${esc(booking.id)}"></div>
      </article>`;
    }).join("");
  }
  function calendarFile(booking) {
    const [start,end]=String(booking.time||"07:30 - 08:00").split(" - ");
    const stamp=(d,t)=>`${d.replace(/-/g,"")}T${(t||"00:00").replace(":","")}00`;
    const safe=v=>String(v||"").replace(/\\/g,"\\\\").replace(/\n/g,"\\n").replace(/[,;]/g,"\\$&");
    const content=["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//iBarber//Agenda//PT-BR","BEGIN:VEVENT",
      `UID:${safe(booking.id)}@ibarber`,`DTSTAMP:${new Date().toISOString().replace(/[-:]/g,"").replace(/\.\d{3}/,"")}`,
      `DTSTART;TZID=America/Sao_Paulo:${stamp(booking.bookingDateIso,start)}`,
      `DTEND;TZID=America/Sao_Paulo:${stamp(booking.bookingDateIso,end)}`,
      `SUMMARY:${safe(booking.serviceName)} - iBarber`, `DESCRIPTION:${safe(booking.professionalName)} / Reserva ${booking.id}`,
      "END:VEVENT","END:VCALENDAR"].join("\r\n");
    const url=URL.createObjectURL(new Blob([content],{type:"text/calendar;charset=utf-8"}));
    const a=el("a",{href:url,download:`ibarber-${booking.id}.ics`});document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);
  }
  async function myAction(button) {
    const action=button.dataset.myAction,id=button.dataset.id;
    const receipt=readReceipts().find(x=>x.id===id);
    const result=visibleReceipts.find(x=>x.receipt.id===id);
    if (action==="forget") {saveReceipts(readReceipts().filter(x=>x.id!==id));return renderMyBookings();}
    if (!receipt || !result?.booking) return;
    const booking=result.booking, secret=receipt.secret;
    if (action==="copy") {
      await navigator.clipboard.writeText(`iBarber\nCódigo: ${id}\nChave privada: ${secret}`);
      return toast("Código e chave copiados. Guarde em local seguro.");
    }
    if (action==="calendar") return calendarFile(booking);
    if (action==="cancel") {
      if (!confirm("Cancelar esta reserva? O horário ficará disponível para outras pessoas.")) return;
      try {await rpc("ibarber_manage_booking",{p_id:id,p_secret:secret,p_action:"cancel"});toast("Reserva cancelada.");await renderMyBookings();busyRefresh();}
      catch(e){toast(e.message);}return;
    }
    const holder=$("myForm-"+id);
    if (action==="reschedule") {
      const buttons=availableTimes.map(t=>`<option value="${esc(getTimeStart(t))}">${esc(getTimeStart(t))}</option>`).join("");
      holder.innerHTML=`<form class="pro-form" data-my-submit="reschedule" data-id="${esc(id)}"><label>Nova data<input name="date" type="date" min="${today()}" required></label><label>Novo horário<select name="time">${buttons}</select></label><p>O servidor verificará a disponibilidade antes de confirmar.</p><button type="submit" class="admin-primary-button full">Confirmar reagendamento</button></form>`;
    }
    if (action==="rate") {
      holder.innerHTML=`<form class="pro-form" data-my-submit="rate" data-id="${esc(id)}"><label>Nota<select name="rating"><option value="5">★★★★★ Excelente</option><option value="4">★★★★☆ Muito bom</option><option value="3">★★★☆☆ Bom</option><option value="2">★★☆☆☆ Regular</option><option value="1">★☆☆☆☆ Ruim</option></select></label><label>Comentário (opcional)<textarea name="comment" maxlength="500" rows="2"></textarea></label><button type="submit" class="admin-primary-button full">Enviar avaliação</button></form>`;
    }
  }
  async function submitMyForm(form) {
    const receipt=readReceipts().find(x=>x.id===form.dataset.id);
    if (!receipt) return;
    const button=form.querySelector("[type=submit]");button.disabled=true;
    try {
      const args={p_id:receipt.id,p_secret:receipt.secret,p_action:form.dataset.mySubmit};
      if (args.p_action==="reschedule") {args.p_date=form.elements.date.value;args.p_time=form.elements.time.value;}
      if (args.p_action==="rate") {args.p_rating=Number(form.elements.rating.value);args.p_comment=form.elements.comment.value;}
      await rpc("ibarber_manage_booking",args);
      toast(args.p_action==="rate"?"Avaliação recebida. Obrigado!":"Horário alterado com sucesso.");
      await renderMyBookings();busyRefresh();
    } catch(e) {toast(e.message);}finally{button.disabled=false;}
  }

  function populateBarberSelect(node, blankLabel) {
    if (!node)return;
    const v=node.value;
    node.innerHTML=`<option value="">${esc(blankLabel)}</option>`+professionals.map(p=>
      `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("");
    if (professionals.some(p=>p.id===v))node.value=v;
  }
  function renderServicesAdmin() {
    const root=$("serviceManagerList");if(!root)return;
    root.innerHTML=services.map(service=>`<article class="pro-row"><div class="pro-row-title"><strong>${esc(service.name)}</strong><span>${esc(service.price)}</span></div>
      <p>${service.durationMinutes||getServiceMinutes(service)} minutos</p>
      <div class="pro-inline-actions"><button class="ghost-button" data-service-action="edit" data-id="${esc(service.id)}">Editar</button><button class="ghost-button ${service.active===false?'':'danger'}" data-service-action="toggle" data-id="${esc(service.id)}">${service.active===false?'Ativar':'Desativar'}</button></div></article>`).join("");
  }
  function renderClientsAdmin() {
    const root=$("clientsManagerList");if(!root)return;
    const byPhone=new Map();
    getStoredBookings().forEach(b=>{
      const phone=String(b.clientPhone||"").replace(/\D/g,"");if (!phone)return;
      const customer=byPhone.get(phone)||{phone,name:b.clientName,bookings:[],spent:0,done:0};
      customer.bookings.push(b);
      if(b.status==="Concluído"){customer.done++;customer.spent+=Number(b.servicePriceValue)||0;}
      byPhone.set(phone,customer);
    });
    const filter=String($("clientAdminSearch")?.value||"").toLocaleLowerCase("pt-BR");
    const filtered=[...byPhone.values()].filter(c=>`${c.name} ${c.phone}`.toLowerCase().includes(filter)).sort((a,b)=>b.done-a.done);
    root.innerHTML=filtered.length?filtered.map(c=>{
      const last=c.bookings.map(b=>b.bookingDateIso).sort().reverse()[0]||"—";
      const digits=c.phone.startsWith("55")?c.phone:`55${c.phone}`;
      return `<article class="pro-row"><div class="pro-row-title"><strong>${esc(c.name)}</strong><span>${c.done} visita(s)</span></div>
      <p>${esc(c.phone)} · Última reserva: ${esc(last)}</p><p>Faturamento por serviços concluídos: ${currency(c.spent)} · Fidelidade: ${c.done%5}/5</p>
      <a class="ghost-button" href="https://wa.me/${digits}" target="_blank" rel="noopener">Conversar pelo WhatsApp</a></article>`;
    }).join(""):'<div class="pro-empty">Nenhum cliente encontrado. Conclua atendimentos para ver a fidelidade.</div>';
  }
  const periodsToMarkup = (day,periods) => {
    const a=periods?.[0]||{},b=periods?.[1]||{};
    return `<div class="pro-weekday"><strong>${weekdays[day]}</strong><div class="pro-hours-pair"><input aria-label="Primeiro início" type="time" data-part="0" data-side="start" data-weekday="${day}" value="${esc(a.start||'')}"><input aria-label="Primeiro fim" type="time" data-part="0" data-side="end" data-weekday="${day}" value="${esc(a.end||'')}"></div><div class="pro-hours-pair"><input aria-label="Segundo início" type="time" data-part="1" data-side="start" data-weekday="${day}" value="${esc(b.start||'')}"><input aria-label="Segundo fim" type="time" data-part="1" data-side="end" data-weekday="${day}" value="${esc(b.end||'')}"></div></div>`;
  };
  function renderSchedule() {
    const barber=$("weeklyBarber")?.value||"",grid=$("weeklyScheduleGrid");if(!grid)return;
    grid.innerHTML=weekdays.map((_,day)=>{
      const custom=activeBarberHours.find(h=>h.professional_id===barber && h.weekday===day);
      return periodsToMarkup(day,barber?(custom?.periods??BUSINESS_HOURS_BY_WEEKDAY[day]):BUSINESS_HOURS_BY_WEEKDAY[day]);
    }).join("");
  }
  function selectedSchedule() {
    const schedule={};
    for(let day=0;day<7;day++) {
      const intervals=[];
      for(let part=0;part<2;part++) {
        const start=$("weeklyScheduleGrid").querySelector(`[data-weekday="${day}"][data-part="${part}"][data-side="start"]`)?.value;
        const end=$("weeklyScheduleGrid").querySelector(`[data-weekday="${day}"][data-part="${part}"][data-side="end"]`)?.value;
        if (Boolean(start)!==Boolean(end)) throw Error(`Preencha início e fim de ${weekdays[day]}.`);
        if(start && end) {if(start>=end)throw Error(`Horário inválido: ${weekdays[day]}.`);intervals.push({start,end});}
      }
      if (intervals.length===2 && intervals[0].end>intervals[1].start) throw Error(`Intervalos sobrepostos: ${weekdays[day]}.`);
      schedule[day]=intervals;
    }
    return schedule;
  }
  function renderBlocksAdmin() {
    const root=$("blocksManagerList"); if(!root)return;
    root.innerHTML=adminData.blocks.length?adminData.blocks.map(b=>{
      const pro=professionals.find(p=>p.id===b.professional_id)?.name||"Toda a equipe";
      return `<article class="pro-row"><div class="pro-row-title"><strong>${esc(b.reason)}</strong><span>${esc(b.block_date)}</span></div>
       <p>${esc(pro)} · ${b.start_time?`${esc(b.start_time.slice(0,5))}–${esc(b.end_time.slice(0,5))}`:"Dia inteiro"}</p>
       <button class="ghost-button danger" data-block-id="${esc(b.id)}">Remover bloqueio</button></article>`;
    }).join(""):'<div class="pro-empty">Sem bloqueios cadastrados.</div>';
  }
  function renderFinancesAdmin() {
    const root=$("financeManagerList"),metrics=$("financeMetrics");if(!root)return;
    const month=today().slice(0,7),current=adminData.finance.filter(e=>e.entry_date.startsWith(month));
    const total=kind=>current.filter(e=>e.kind===kind).reduce((sum,e)=>sum+Number(e.amount),0);
    const payments=total("payment"),expenses=total("expense"),commissions=total("commission");
    const completed=getStoredBookings().filter(b=>b.status==="Concluído"&&b.bookingDateIso.startsWith(month));
    const projected=completed.reduce((n,b)=>n+Number(b.servicePriceValue||0),0);
    metrics.innerHTML=[['Serviços concluídos',projected],['Recebimentos lançados',payments],['Despesas + comissões',expenses+commissions],['Saldo de caixa registrado',payments-expenses-commissions]]
      .map(([name,value])=>`<div class="pro-metric"><span>${name}</span><strong>${currency(value)}</strong></div>`).join("");
    root.innerHTML=adminData.finance.length?adminData.finance.map(entry=>`<article class="pro-row"><div class="pro-row-title"><strong>${esc(entry.description)}</strong><span>${currency(entry.amount)}</span></div>
      <p>${esc(entry.entry_date)} · ${esc(entry.kind)} · ${esc(entry.method)}</p><button class="ghost-button danger" data-finance-id="${esc(entry.id)}">Excluir</button></article>`).join(""):'<div class="pro-empty">Nenhum lançamento financeiro.</div>';
  }
  function renderStaffAdmin() {
    const root=$("staffList");if(!root)return;
    root.innerHTML=adminData.staff.map(item=>`<article class="pro-row"><div class="pro-row-title"><strong>${esc(item.display_name)}</strong><span>${esc(item.role)}</span></div><p>${esc(item.user_id)} · ${item.active?'Ativo':'Inativo'}</p></article>`).join("");
  }
  function renderAdvancedMetrics() {
    const root=$("advancedMetrics");if(!root)return;
    const bookings=getStoredBookings();
    const month=today().slice(0,7);
    const monthly=bookings.filter(b=>b.bookingDateIso?.startsWith(month));
    const valid=monthly.filter(b=>!["Cancelado","Ausente"].includes(b.status));
    const absent=monthly.filter(b=>b.status==="Ausente").length;
    const canceled=monthly.filter(b=>b.status==="Cancelado").length;
    const customerCounts=new Map();
    valid.filter(b=>b.status==="Concluído").forEach(b=>{
      const id=String(b.clientPhone||"").replace(/\D/g,"");
      customerCounts.set(id,(customerCounts.get(id)||0)+1);
    });
    const recurring=[...customerCounts.values()].filter(count=>count>1).length;
    const validTimes=valid.map(b=>getTimeStart(b.time));
    const popular=[...new Set(validTimes)].sort((a,b)=>validTimes.filter(t=>t===b).length-validTimes.filter(t=>t===a).length)[0]||"—";
    // Taxa de ocupação: minutos agendados / minutos disponíveis no expediente do mês.
    const year=Number(month.slice(0,4)),m=Number(month.slice(5,7))-1;
    const shopDays=Array.from({length:new Date(year,m+1,0).getDate()},(_,i)=>new Date(year,m,i+1));
    const minutes=shopDays.reduce((sum,d)=>sum + getBusinessHoursForDate(d).reduce((total,x)=>total + Math.max(0,parseTime(x.end)-parseTime(x.start)),0),0);
    const staffed=Math.max(1,getActiveProfessionals().length);
    const booked=valid.reduce((sum,b)=>sum+Math.max(0,parseTime(getTimeEnd(b.time))-parseTime(getTimeStart(b.time))),0);
    const occupancy=minutes>0?Math.min(100,Math.round(booked*100/(minutes*staffed))):0;
    const metrics=[["Ocupação do mês",`${occupancy}%`],["Faltas / cancelamentos",`${absent} / ${canceled}`],["Clientes recorrentes",String(recurring)],["Horário mais procurado",popular]];
    root.innerHTML=metrics.map(([name,value])=>`<div class="pro-metric"><span>${name}</span><strong>${esc(value)}</strong></div>`).join("");
  }
  window.ibarberRenderEnhancedAdmin = () => {
    renderServicesAdmin();renderClientsAdmin();renderSchedule();renderBlocksAdmin();renderFinancesAdmin();renderStaffAdmin();renderAdvancedMetrics();
  };
  async function loadAdminConfiguration() {
    if(isLoadingAdmin || !(await isAdminAuthenticated()))return;
    isLoadingAdmin=true;
    const request=[
      ["blocks","ibarber_blocks",q=>q.select("*").order("block_date",{ascending:false}).limit(150)],
      ["barberHours","ibarber_barber_hours",q=>q.select("*")],
      ["finance","ibarber_finance",q=>q.select("*").order("entry_date",{ascending:false}).limit(200)],
      ["staff","ibarber_staff",q=>q.select("*")],
      ["serviceAll","ibarber_services",q=>q.select("*").order("sort_order")],
    ];
    const results=await Promise.allSettled(request.map(([,table,operation])=>query(table,operation)));
    results.forEach((result,index)=>{
      if(result.status!=="fulfilled")return;
      const label=request[index][0];
      if(label==="serviceAll") {
        services=result.value.map(r=>({id:r.id,name:r.name,price:currency(r.price),durationMinutes:r.duration_min,
          duration:`${r.duration_min} min`,image:r.image||"assets/service-default.svg",active:r.active}));
        renderServices();
      } else adminData[label]=result.value||[];
    });
    activeBarberHours=adminData.barberHours;
    populateBarberSelect($("weeklyBarber"),"Barbearia — horário padrão");
    populateBarberSelect($("blockBarber"),"Todos os barbeiros");
    if(!$("blockDate").value)$("blockDate").value=today();
    if(!$("financeDate").value)$("financeDate").value=today();
    window.ibarberRenderEnhancedAdmin();
    isLoadingAdmin=false;
  }
  window.ibarberOnAdminOpen = loadAdminConfiguration;

  async function saveService(event) {
    event.preventDefault(); const form=event.currentTarget, btn=form.querySelector('[type="submit"]');btn.disabled=true;
    try {
      const id=$("serviceEditId").value||`svc-${randomSecureHex(16)}`;
      const value={id,name:$("serviceNameInput").value.trim(),price:Number($("servicePriceInput").value),
        duration_min:Number($("serviceMinutesInput").value), image:$("serviceImageInput").value.trim(),active:true};
      const {error}=await client().from("ibarber_services").upsert(value,{onConflict:"id"});if(error)throw Error(error.message);
      form.reset();$("serviceEditId").value="";
      feedback("serviceFeedback","Serviço salvo no Supabase.");
      await loadPublicConfiguration();await loadAdminConfiguration();
    }catch(error){feedback("serviceFeedback",error.message);}finally{btn.disabled=false;}
  }
  async function serviceAction(button) {
    const service=services.find(s=>s.id===button.dataset.id);if(!service)return;
    if(button.dataset.serviceAction==="edit") {
      $("serviceEditId").value=service.id;$("serviceNameInput").value=service.name;
      $("servicePriceInput").value=parsePriceToNumber(service.price);$("serviceMinutesInput").value=getServiceMinutes(service);
      $("serviceImageInput").value=service.image||"";$("serviceNameInput").focus();return;
    }
    const active=service.active===false;
    try {const {error}=await client().from("ibarber_services").update({active}).eq("id",service.id);if(error)throw Error(error.message);
      service.active=active;renderServicesAdmin();await loadPublicConfiguration();toast("Serviço atualizado.");}
    catch(error){toast(error.message);}
  }
  async function saveSchedule(event) {
    event.preventDefault();
    try {
      const schedule=selectedSchedule(),id=$("weeklyBarber").value;
      if(!id) {
        const {error}=await client().from("ibarber_settings").update({business_hours:schedule}).eq("id",1);
        if(error)throw Error(error.message);
        adminData.settings.business_hours=schedule;reflectShopSettings(adminData.settings);
      }else{
        const rows=weekdays.map((_,weekday)=>({professional_id:id,weekday,periods:schedule[weekday]}));
        const {error}=await client().from("ibarber_barber_hours").upsert(rows,{onConflict:"professional_id,weekday"});
        if(error)throw Error(error.message);
        activeBarberHours=activeBarberHours.filter(x=>x.professional_id!==id).concat(rows);
      }
      feedback("availabilityFeedback","Expediente salvo com sucesso.");renderDays();busyRefresh();
    }catch(error){feedback("availabilityFeedback",error.message);}
  }
  async function createBlock(event) {
    event.preventDefault();
    const start=$("blockStart").value,end=$("blockEnd").value;
    if(Boolean(start)!==Boolean(end) || (start && start>=end))return feedback("availabilityFeedback","Informe início e fim válidos, ou deixe ambos em branco para dia inteiro.");
    const row={block_date:$("blockDate").value,professional_id:$("blockBarber").value||null,
      start_time:start||null,end_time:end||null,reason:$("blockReason").value.trim()};
    try {const {error}=await client().from("ibarber_blocks").insert(row);if(error)throw Error(error.message);
      event.target.reset();$("blockDate").value=today();
      adminData.blocks=await query("ibarber_blocks",q=>q.select("*").order("block_date",{ascending:false}).limit(150));
      renderBlocksAdmin();busyRefresh();feedback("availabilityFeedback","Bloqueio criado.");}
    catch(e){feedback("availabilityFeedback",e.message);}
  }
  async function createFinance(event) {
    event.preventDefault(); const row={kind:$("financeKind").value,description:$("financeDescription").value.trim(),
      amount:Number($("financeAmount").value),entry_date:$("financeDate").value,method:$("financeMethod").value};
    try {const {error}=await client().from("ibarber_finance").insert(row);if(error)throw Error(error.message);
      event.target.reset();$("financeDate").value=today();
      adminData.finance=await query("ibarber_finance",q=>q.select("*").order("entry_date",{ascending:false}).limit(200));
      renderFinancesAdmin();feedback("financeFeedback","Lançamento salvo.");}
    catch(e){feedback("financeFeedback",e.message);}
  }
  async function saveSettings(event) {
    event.preventDefault();
    const row={shop_name:$("shopName").value.trim(),whatsapp:$("shopWhatsapp").value.replace(/\D/g,""),
      instagram:$("shopInstagram").value.trim(),address:$("shopAddress").value.trim(),city:$("shopCity").value.trim()};
    try {const {error}=await client().from("ibarber_settings").update(row).eq("id",1);if(error)throw Error(error.message);
      reflectShopSettings({...adminData.settings,...row});feedback("settingsFeedback","Informações atualizadas.");}
    catch(e){feedback("settingsFeedback",e.message);}
  }
  async function saveStaff(event) {
    event.preventDefault();
    const row={user_id:$("staffUserId").value.trim(),display_name:$("staffDisplayName").value.trim(),role:$("staffRole").value,active:true};
    try {const {error}=await client().from("ibarber_staff").upsert(row,{onConflict:"user_id"});if(error)throw Error(error.message);
      adminData.staff=await query("ibarber_staff",q=>q.select("*"));renderStaffAdmin();event.target.reset();toast("Permissão salva.");}
    catch(e){toast("Apenas proprietários podem gerenciar a equipe: "+e.message);}
  }
  function bind() {
    $("myReservationsButton")?.addEventListener("click",window.ibarberOpenMyBookings);
    $("myReservationsModal")?.addEventListener("click",e=>{
      if(e.target.closest("[data-close-my-reservations]"))hideModal("myReservationsModal");
      const button=e.target.closest("[data-my-action]");if(button)myAction(button).catch(err=>toast(err.message));
    });
    $("myReservationsModal")?.addEventListener("submit",e=>{
      if(e.target.matches("[data-my-submit]")){e.preventDefault();submitMyForm(e.target);}
    });
    $("retrieveBookingForm")?.addEventListener("submit",async e=>{
      e.preventDefault();const id=$("retrieveBookingId").value.trim(),secret=$("retrieveBookingSecret").value.trim();
      try {const booking=await rpc("ibarber_manage_booking",{p_id:id,p_secret:secret,p_action:"view"});
        storeReceipt({id,secret,date:booking.bookingDateIso,name:booking.serviceName});
        feedback("myBookingsFeedback","Reserva recuperada com segurança.");await renderMyBookings();}
      catch(error){feedback("myBookingsFeedback",error.message);}
    });
    $("openPrivacyPolicy")?.addEventListener("click",()=>showModal("privacyModal"));
    $("privacyModal")?.addEventListener("click",e=>{if(e.target.closest("[data-close-privacy]"))hideModal("privacyModal");});
    document.addEventListener("keydown",e=>{if(e.key==="Escape"){hideModal("myReservationsModal");hideModal("privacyModal");}});
    $("copyBookingButton")?.addEventListener("click",async()=>{
      const id=state.bookingId,secret=bookingSecret(id);if(!id||!secret)return toast("Comprovante indisponível neste navegador.");
      await navigator.clipboard.writeText(`Código: ${id}\nChave privada: ${secret}`);toast("Comprovante copiado.");
    });
    $("calendarDownloadButton")?.addEventListener("click",()=>{
      const id=state.bookingId,b=getStoredBookings().find(item=>item.id===id);
      if(b)calendarFile(b);else toast("Reserva não encontrada neste dispositivo.");
    });
    $("serviceManagerForm")?.addEventListener("submit",saveService);
    $("serviceFormReset")?.addEventListener("click",()=>{$("serviceManagerForm").reset();$("serviceEditId").value="";});
    $("serviceManagerList")?.addEventListener("click",e=>{const button=e.target.closest("[data-service-action]");if(button)serviceAction(button);});
    $("clientAdminSearch")?.addEventListener("input",renderClientsAdmin);
    $("weeklyBarber")?.addEventListener("change",renderSchedule);
    $("weeklyHoursForm")?.addEventListener("submit",saveSchedule);
    $("blockForm")?.addEventListener("submit",createBlock);
    $("blocksManagerList")?.addEventListener("click",async e=>{
      const id=e.target.closest("[data-block-id]")?.dataset.blockId;if(!id||!confirm("Remover este bloqueio?"))return;
      const {error}=await client().from("ibarber_blocks").delete().eq("id",id);
      if(error)return toast(error.message);
      adminData.blocks=adminData.blocks.filter(x=>x.id!==id);renderBlocksAdmin();busyRefresh();
    });
    $("financeForm")?.addEventListener("submit",createFinance);
    $("financeManagerList")?.addEventListener("click",async e=>{
      const id=e.target.closest("[data-finance-id]")?.dataset.financeId;if(!id||!confirm("Excluir lançamento?"))return;
      const {error}=await client().from("ibarber_finance").delete().eq("id",id);
      if(error)return toast(error.message);
      adminData.finance=adminData.finance.filter(x=>x.id!==id);renderFinancesAdmin();
    });
    $("shopSettingsForm")?.addEventListener("submit",saveSettings);
    $("staffForm")?.addEventListener("submit",saveStaff);
    window.addEventListener("ibarber:reservation-saved",async()=>{await renderMyBookingsIfVisible();});
    window.addEventListener("online",()=>{toast("Conexão restaurada. Atualizando horários...");busyRefresh();});
    window.addEventListener("offline",()=>toast("Sem internet. Novas reservas ficarão indisponíveis."));
  }
  async function renderMyBookingsIfVisible(){const m=$("myReservationsModal");if(m&&!m.hidden)await renderMyBookings();}
  bind();
  const brandLogo = new Image();
  brandLogo.onerror=()=>document.body.classList.add("missing-brand-assets");
  brandLogo.src="./ibarber.png";
  loadPublicConfiguration().catch(err=>console.warn("Configuração remota indisponível",err));
  window.addEventListener("focus",()=>{updateOpenStatus();busyRefresh();});
  if("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register("./service-worker.js").catch(err=>console.warn("PWA não disponível",err));
  }
})();
