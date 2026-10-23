// Mensaje propio para las contraseñas cortas en todo <input type="password"
// minlength="..."> (registro, usuarios, configuración, restablecer): el
// navegador bloquea el envío con minlength, pero su texto depende del idioma
// del navegador. Así el aviso es el mismo que devuelve auth-service.
(function () {
  function revisar(input) {
    const minimo = Number(input.getAttribute("minlength"));
    // vacío no cuenta: ya lo cubre `required` (o es opcional, como al editar un usuario)
    const corta = input.value.length > 0 && input.value.length < minimo;
    input.setCustomValidity(corta ? "La contraseña debe tener al menos " + minimo + " caracteres." : "");
  }

  function iniciar() {
    document.querySelectorAll('input[type="password"][minlength]').forEach(function (input) {
      // change también: el autocompletado del navegador no siempre dispara input
      input.addEventListener("input", function () { revisar(input); });
      input.addEventListener("change", function () { revisar(input); });
      revisar(input);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar);
  else iniciar();
})();
