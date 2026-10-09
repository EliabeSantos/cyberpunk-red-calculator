// Testes legados que exercitam o adapter Supabase escolhem o modo de forma
// explícita no harness. Testes de configuração continuam passando o argumento
// diretamente e, portanto, ainda cobrem modo ausente/inválido.
if (!process.env.MESA_HOSTING_MODE) process.env.MESA_HOSTING_MODE = "supabase";
