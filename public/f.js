// Script d'intégration (Embed) pour Formulaires Intralys
// Utilisation : <script src="https://crm.intralys.com/f.js" data-form="mon-slug"></script>

(function() {
  const currentScript = document.currentScript;
  if (!currentScript) {
    console.error("Intralys Form: Impossible de trouver le script courant.");
    return;
  }

  // Obtenir le slug depuis l'attribut data-form (ex: data-form="contact-2026")
  let formSlug = currentScript.getAttribute('data-form');
  
  // Rétrocompatibilité : si l'URL est /f/mon-slug.js
  if (!formSlug) {
    const src = currentScript.getAttribute('src') || '';
    const match = src.match(/\/f\/([^\/]+)(?:\.js)?$/);
    if (match) formSlug = match[1];
  }

  if (!formSlug) {
    console.error("Intralys Form: Aucun slug fourni. Utilisez data-form='votre-slug'.");
    return;
  }

  // Déterminer l'URL de base (pour le mode dev et prod)
  const scriptUrl = new URL(currentScript.src);
  const baseUrl = scriptUrl.origin;
  const targetUrl = `${baseUrl}/f/${formSlug}`;

  // Créer un wrapper pour gérer la responsivité
  const wrapper = document.createElement('div');
  wrapper.className = 'intralys-form-wrapper';
  wrapper.style.width = '100%';
  wrapper.style.minHeight = '500px';
  wrapper.style.overflow = 'hidden';
  wrapper.style.position = 'relative';

  // Créer l'iframe
  const iframe = document.createElement('iframe');
  iframe.src = targetUrl;
  iframe.style.width = '100%';
  iframe.style.height = '100%';
  iframe.style.border = 'none';
  iframe.style.position = 'absolute';
  iframe.style.top = '0';
  iframe.style.left = '0';
  iframe.title = "Formulaire Intralys";
  iframe.setAttribute('allowtransparency', 'true');

  // Gérer la hauteur dynamique via postMessage
  window.addEventListener('message', function(event) {
    // Vérifier l'origine pour la sécurité
    if (event.origin !== baseUrl) return;
    
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'intralys-form-resize' && data.slug === formSlug) {
        if (data.height) {
          wrapper.style.minHeight = data.height + 'px';
          iframe.style.height = data.height + 'px';
        }
      }
    } catch (e) {
      // Ignorer les messages mal formés
    }
  });

  wrapper.appendChild(iframe);
  
  // Remplacer le script ou l'insérer juste après
  currentScript.parentNode.insertBefore(wrapper, currentScript.nextSibling);
})();
