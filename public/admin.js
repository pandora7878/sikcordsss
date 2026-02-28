const token = localStorage.getItem('token');

async function api(url) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Hata');
  return data;
}

async function load() {
  try {
    const stats = await api('/api/admin/stats');
    const users = await api('/api/admin/users');

    document.getElementById('stats').innerHTML = `
      <div><b>Kullanıcı</b><br>${stats.users}</div>
      <div><b>Grup</b><br>${stats.groups}</div>
      <div><b>Mesaj</b><br>${stats.messages}</div>
      <div><b>Arkadaşlık</b><br>${stats.friendships}</div>
    `;

    document.getElementById('userRows').innerHTML = users.map((u) => `
      <tr>
        <td>${u.id}</td>
        <td>${u.username}</td>
        <td>${u.email}</td>
        <td style="max-width:240px;word-break:break-all;">${u.password_hash}</td>
        <td>${u.last_ip || '-'}</td>
        <td>${u.is_admin ? 'Evet' : 'Hayır'}</td>
        <td>${u.created_at || '-'}</td>
        <td>${u.last_login_at || '-'}</td>
      </tr>
    `).join('');
  } catch (e) {
    document.body.innerHTML = '<h2>Admin panel için önce admin hesabıyla giriş yapmalısınız.</h2>';
  }
}

load();
