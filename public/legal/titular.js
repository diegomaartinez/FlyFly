// Datos del titular de la web: rellénalos UNA vez y se usan en todas las páginas legales.
// Obligatorios por la LSSI (art. 10) y el RGPD. Si es una sociedad, añade los datos registrales.
window.TITULAR = {
  nombre: '[NOMBRE Y APELLIDOS O RAZÓN SOCIAL]',
  nif: '[NIF / CIF]',
  domicilio: '[DIRECCIÓN POSTAL COMPLETA]',
  email: '[EMAIL DE CONTACTO]',
  web: '[DOMINIO, p. ej. flyfly.es]',
  registro: '', // p. ej. 'Inscrita en el Registro Mercantil de A Coruña, tomo X, folio Y, hoja Z' (solo sociedades)
  actualizado: '1 de octubre de 2026',
};

// Rellena los <span data-titular="campo"> de la página.
document.addEventListener('DOMContentLoaded', () => {
  const t = window.TITULAR;
  document.querySelectorAll('[data-titular]').forEach((el) => {
    const value = t[el.dataset.titular];
    if (!value) { el.closest('[data-optional]')?.remove(); return; }
    if (el.dataset.titular === 'email' && el.tagName === 'A') el.href = `mailto:${value}`;
    el.textContent = value;
  });
  // Botón "Gestionar cookies": reabre el aviso de consentimiento de Google si la publicidad está activa.
  const manage = document.getElementById('manage-consent');
  if (manage) manage.onclick = () => {
    if (window.googlefc) window.googlefc.callbackQueue.push(window.googlefc.showRevocationMessage);
    else alert('Ahora mismo la web no usa cookies que necesiten tu consentimiento.');
  };
});
