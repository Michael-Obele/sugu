// SPA shell: the Worker serves one static index.html and every route renders on the
// client, so there is no server render and nothing to prerender.
export const ssr = false;
export const prerender = false;
