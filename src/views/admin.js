// User administration: approve accounts and set roles.
import { supabase } from '../supabase.js';
import { S, ROLE_LABEL } from '../lib/data.js';
import { esc, arm, toast } from '../lib/util.js';

let el, users = [];
export async function mount(root) {
  el = root;
  el.innerHTML = `<section class="panel"><h2>Usuários</h2>
    <p class="note">Quem cria uma conta entra como “Aguardando aprovação” e não vê nenhum dado até você escolher um perfil. <strong>Leitor</strong> vê portfólio, simulador e o quadro de recursos sem custo-hora individual. <strong>Editor</strong> também vê custos por pessoa e altera dados. <strong>Administrador</strong> também gerencia usuários.</p>
    <div class="tablewrap"><table id="uT"></table></div></section>`;
  await load();
}
async function load() {
  const { data, error } = await supabase.from('profiles').select('*').order('created_at');
  if (error) throw new Error(error.message);
  users = data; draw();
}
function draw() {
  const me = S.profile.id;
  el.querySelector('#uT').innerHTML = `<thead><tr><th>E-mail</th><th>Nome</th><th>Perfil</th><th>Criado em</th><th></th></tr></thead><tbody>` + users.map((u) => `<tr>
    <td>${esc(u.email)}${u.id === me ? ' <span class="code">(você)</span>' : ''}</td><td>${esc(u.full_name || '')}</td>
    <td><select data-u="${u.id}" aria-label="Perfil de ${esc(u.email)}" ${u.id === me ? 'disabled' : ''}>${Object.entries(ROLE_LABEL).map(([k, v]) => `<option value="${k}" ${u.role === k ? 'selected' : ''}>${v}</option>`).join('')}</select>${u.role === 'pendente' ? ' <span class="chip c-warn">novo</span>' : ''}</td>
    <td class="num">${new Date(u.created_at).toLocaleDateString('pt-BR')}</td>
    <td>${u.id === me ? '' : `<button class="x" data-rm="${u.id}">Remover acesso</button>`}</td></tr>`).join('') + '</tbody>';
  el.querySelectorAll('select[data-u]').forEach((s) => (s.onchange = async () => {
    const u = users.find((x) => x.id === s.dataset.u);
    const { error } = await supabase.from('profiles').update({ role: s.value }).eq('id', u.id);
    if (error) { toast(error.message, 'error'); s.value = u.role; return; }
    u.role = s.value; toast(`${u.email} agora é ${ROLE_LABEL[u.role]}.`); draw();
  }));
  el.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => arm(b, 'Remover acesso', async () => {
    const u = users.find((x) => x.id === b.dataset.rm);
    const { error } = await supabase.from('profiles').update({ role: 'pendente' }).eq('id', u.id);
    if (error) return toast(error.message, 'error');
    u.role = 'pendente'; toast(`${u.email} voltou para “Aguardando aprovação” e não vê mais os dados.`); draw();
  })));
}
