import { supabase } from '../supabase.js';

export function renderLogin(app) {
  let mode = 'in';
  const draw = () => {
    app.innerHTML = `<div class="login">
      <div><div class="label">Seidor · Agro &amp; Internacional · Delivery</div><h1>Resource Planning</h1>
      <p class="note">Carga planejada, forecast e realizado do portfólio, simulador de cenários e quadro de recursos.</p></div>
      <form class="panel" id="f">
        <h2>${mode === 'in' ? 'Entrar' : mode === 'up' ? 'Criar conta' : 'Recuperar senha'}</h2>
        ${mode === 'up' ? '<div class="ctl"><label class="label" for="nm">Nome</label><input id="nm" type="text" autocomplete="name" required></div>' : ''}
        <div class="ctl"><label class="label" for="em">E-mail</label><input id="em" type="email" autocomplete="email" required></div>
        ${mode !== 'reset' ? `<div class="ctl"><label class="label" for="pw">Senha</label><input id="pw" type="password" autocomplete="${mode === 'in' ? 'current-password' : 'new-password'}" minlength="8" required></div>` : ''}
        <button class="primary" type="submit">${mode === 'in' ? 'Entrar' : mode === 'up' ? 'Criar conta' : 'Enviar link'}</button>
        <div id="m" class="msg" role="status" aria-live="polite"></div>
        <div class="row">
          ${mode !== 'in' ? '<button type="button" data-m="in">Já tenho conta</button>' : '<button type="button" data-m="up">Criar conta</button><button type="button" data-m="reset">Esqueci a senha</button>'}
        </div>
      </form></div>`;
    app.querySelectorAll('[data-m]').forEach((b) => (b.onclick = () => { mode = b.dataset.m; draw(); }));
    const m = app.querySelector('#m');
    app.querySelector('#f').addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = app.querySelector('#em').value.trim(), pw = app.querySelector('#pw')?.value;
      m.className = 'msg'; m.textContent = 'Aguarde…';
      let res;
      if (mode === 'in') res = await supabase.auth.signInWithPassword({ email, password: pw });
      else if (mode === 'up') res = await supabase.auth.signUp({ email, password: pw, options: { data: { full_name: app.querySelector('#nm').value.trim() }, emailRedirectTo: location.origin } });
      else res = await supabase.auth.resetPasswordForEmail(email, { redirectTo: location.origin });
      if (res.error) {
        m.className = 'msg err';
        m.textContent = /invalid login/i.test(res.error.message) ? 'E-mail ou senha incorretos.' : /not confirmed/i.test(res.error.message) ? 'Confirme seu e-mail pelo link que enviamos antes de entrar.' : res.error.message;
      } else if (mode === 'up' && !res.data.session) m.textContent = 'Conta criada. Confirme pelo link enviado ao seu e-mail e depois entre.';
      else if (mode === 'reset') m.textContent = 'Se o e-mail existir, enviamos um link para redefinir a senha.';
    });
  };
  draw();
}
