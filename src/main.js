import './styles.css';
import { supabase, configured } from './supabase.js';
import { S, loadProfile, isEditor, isAdmin, isReader, ROLE_LABEL, QUICK_EVENT } from './lib/data.js';
import { esc, toast } from './lib/util.js';
import { renderLogin } from './views/login.js';

const app = document.getElementById('app');
const TABS = [
  { id: 'portfolio', label: 'Portfólio', load: () => import('./views/portfolio.js'), can: isReader },
  { id: 'simulador', label: 'Simulador', load: () => import('./views/simulator.js'), can: isReader },
  { id: 'recursos', label: 'Recursos', load: () => import('./views/roster.js'), can: isReader },
  { id: 'horas', label: 'Horas (TIMEFLOW)', load: () => import('./views/hours.js'), can: isEditor },
  { id: 'custo', label: 'Custo-hora (ABC)', load: () => import('./views/abc.js'), can: isEditor },
  { id: 'usuarios', label: 'Usuários', load: () => import('./views/admin.js'), can: isAdmin },
];
let current = null, userId = null;

async function route() {
  if (!S.session) { userId = null; renderLogin(app); return; }
  if (userId !== S.session.user.id) {
    userId = S.session.user.id;
    try { await loadProfile(); } catch (e) { app.innerHTML = `<div class="login"><h1>Seidor Resource Planning</h1><p class="msg err">${esc(e.message)}</p></div>`; return; }
  }
  if (!S.profile || S.profile.role === 'pendente') { renderPending(); return; }
  const tabs = TABS.filter((t) => t.can());
  const id = location.hash.slice(1);
  const tab = tabs.find((t) => t.id === id) || tabs[0];
  app.innerHTML = `<div class="wrap">
    <header class="top">
      <div><div class="label">Seidor · Agro &amp; Internacional · Delivery</div><h1>Resource Planning</h1></div>
      <div class="user"><span>${esc(S.profile.email)} · ${ROLE_LABEL[S.profile.role]}</span><button id="logout">Sair</button></div>
    </header>
    <nav class="tabs" aria-label="Seções">${tabs.map((t) => `<a href="#${t.id}" ${t === tab ? 'aria-current="page"' : ''}>${t.label}</a>`).join('')}</nav>
    <main id="view"><p class="note">Carregando…</p></main></div>`;
  document.getElementById('logout').onclick = () => supabase.auth.signOut();
  const view = document.getElementById('view');
  try {
    const mod = await tab.load();
    current = mod;
    await mod.mount(view);
  } catch (e) {
    console.error(e);
    view.innerHTML = `<div class="panel"><h2>Não foi possível carregar esta seção</h2><p class="msg err">${esc(e.message)}</p><div><button id="retry">Tentar de novo</button></div></div>`;
    document.getElementById('retry').onclick = route;
  }
}

function renderPending() {
  app.innerHTML = `<div class="login"><div><div class="label">Seidor · Delivery</div><h1>Resource Planning</h1></div>
    <div class="panel"><h2>Acesso aguardando aprovação</h2>
    <p class="note">Sua conta (${esc(S.session.user.email)}) foi criada. Um administrador precisa liberar seu acesso antes de você ver os dados.</p>
    <div class="row"><button id="again" class="primary">Verificar de novo</button><button id="logout">Sair</button></div></div></div>`;
  document.getElementById('logout').onclick = () => supabase.auth.signOut();
  document.getElementById('again').onclick = async () => { userId = null; await route(); if (S.profile?.role === 'pendente') toast('Seu acesso ainda não foi liberado.'); };
}

function renderNewPassword() {
  app.innerHTML = `<div class="login"><h1>Resource Planning</h1><form class="panel" id="np"><h2>Definir nova senha</h2>
    <div class="ctl"><label class="label" for="npw">Nova senha</label><input id="npw" type="password" minlength="8" autocomplete="new-password" required></div>
    <button class="primary" type="submit">Salvar senha</button><div id="npm" class="msg" role="status"></div></form></div>`;
  document.getElementById('np').addEventListener('submit', async (e) => {
    e.preventDefault();
    const { error } = await supabase.auth.updateUser({ password: document.getElementById('npw').value });
    if (error) { const m = document.getElementById('npm'); m.className = 'msg err'; m.textContent = error.message; } else { toast('Senha alterada.'); userId = null; route(); }
  });
}

async function boot() {
  if (!configured) {
    app.innerHTML = `<div class="login"><h1>Seidor Resource Planning</h1><div class="panel"><h2>Configuração ausente</h2><p class="note">Defina VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY (veja .env.example) e publique de novo.</p></div></div>`;
    return;
  }
  const { data } = await supabase.auth.getSession();
  S.session = data.session;
  supabase.auth.onAuthStateChange((_ev, session) => {
    const before = S.session?.user?.id, after = session?.user?.id;
    S.session = session;
    if (_ev === 'PASSWORD_RECOVERY') { setTimeout(renderNewPassword, 0); return; }
    if (before !== after) setTimeout(route, 0);
  });
  window.addEventListener('hashchange', route);
  document.addEventListener(QUICK_EVENT, (e) => current?.onChange?.(e.detail));
  route();
}
boot();
