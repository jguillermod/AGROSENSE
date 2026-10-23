// Botón de ojo para mostrar u ocultar la contraseña.
// Se aplica solo a todo <input type="password"> de la página (login, registro,
// restablecer, usuarios, configuración): basta con incluir este script.
// Las contraseñas empiezan ocultas y se vuelven a ocultar al enviar el
// formulario, para que el navegador no las guarde como texto visible.
(function () {
  function agregarBoton(input) {
    if (input.dataset.verPassword) return;
    input.dataset.verPassword = "1";

    const campo = document.createElement("span");
    campo.className = "password-campo";
    input.parentNode.insertBefore(campo, input);
    campo.appendChild(input);

    const boton = document.createElement("button");
    boton.type = "button";
    boton.className = "password-toggle";
    boton.innerHTML = '<i class="bi bi-eye" aria-hidden="true"></i>';
    campo.appendChild(boton);

    function mostrar(visible) {
      input.type = visible ? "text" : "password";
      boton.querySelector("i").className = visible ? "bi bi-eye-slash" : "bi bi-eye";
      boton.setAttribute("aria-label", visible ? "Ocultar contraseña" : "Mostrar contraseña");
      boton.setAttribute("aria-pressed", String(visible));
      boton.title = boton.getAttribute("aria-label");
    }

    mostrar(false);
    boton.addEventListener("click", function () {
      mostrar(input.type === "password");
      input.focus();
    });
    if (input.form) input.form.addEventListener("submit", function () { mostrar(false); });
  }

  function iniciar() {
    document.querySelectorAll('input[type="password"]').forEach(agregarBoton);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar);
  else iniciar();
})();
