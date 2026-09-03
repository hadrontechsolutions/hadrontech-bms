/* ============================================================
   router.js — hash-based navigation, sidebar highlighting, breadcrumbs
   ============================================================ */

const _routes = []; // { pattern: RegExp, keys: [...], handler: fn }

/** Register a route. Path like '/customers/:id/edit'. */
function route(path, handler) {
  const keys = [];
  const pattern = new RegExp('^' + path.replace(/:[^/]+/g, (m) => { keys.push(m.slice(1)); return '([^/]+)'; }) + '$');
  _routes.push({ pattern, keys, handler });
}

function navigate(hash) {
  if (!guardNavigation()) return;
  clearDirty();
  window.location.hash = hash;
}

async function resolveRoute() {
  const raw = window.location.hash.replace(/^#/, '') || '/dashboard';
  const [path, queryStr] = raw.split('?');
  const query = Object.fromEntries(new URLSearchParams(queryStr || ''));

  for (const r of _routes) {
    const m = path.match(r.pattern);
    if (m) {
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      highlightSidebar(path);
      try {
        await r.handler(params, query);
      } catch (err) {
        console.error(err);
        document.getElementById('content').innerHTML =
          `<div class="empty-state"><h3>Something went wrong</h3><p>${escapeHtml(err.message)}</p></div>`;
      }
      return;
    }
  }
  document.getElementById('content').innerHTML = `<div class="empty-state"><h3>Page not found</h3></div>`;
}

function highlightSidebar(path) {
  const section = '/' + (path.split('/')[1] || 'dashboard');
  document.querySelectorAll('.nav-link').forEach(a => {
    // data-section can list more than one path (space-separated) for pages whose detail
    // view lives under a different first segment than its own list page — e.g. Payments
    // (/payments) and individual Proforma Invoices (/proforma-invoices/:id) are the same
    // section from a navigation standpoint, but don't share a URL prefix.
    const sections = (a.dataset.section || '').split(' ');
    a.classList.toggle('active', sections.includes(section));
  });
}

function setBreadcrumb(parts) {
  // parts: [{label, hash?}] — last item has no link
  const wrap = document.getElementById('breadcrumb');
  wrap.innerHTML = parts.map((p, i) => {
    const isLast = i === parts.length - 1;
    if (isLast || !p.hash) return `<span class="crumb-current">${escapeHtml(p.label)}</span>`;
    return `<a href="#${p.hash}" class="crumb-link">${escapeHtml(p.label)}</a>`;
  }).join('<span class="crumb-sep">/</span>');
}

window.Router = { route, navigate, resolveRoute, setBreadcrumb };
window.addEventListener('hashchange', resolveRoute);
