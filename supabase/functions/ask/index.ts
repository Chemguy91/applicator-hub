// Retired. See README.
Deno.serve(() => new Response(JSON.stringify({ error: "This feature has been retired." }), { status: 410, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }));
