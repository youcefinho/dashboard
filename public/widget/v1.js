/**
 * Intralys Webchat Widget v1
 * Script à injecter sur les sites clients
 */
(function() {
  if (window.__intralys_webchat) return;
  window.__intralys_webchat = true;

  // Récupérer le client ID depuis le script tag
  var scriptTag = document.currentScript || document.querySelector('script[src*="v1.js"]');
  var clientId = scriptTag ? scriptTag.getAttribute('data-client') : null;
  if (!clientId) {
    console.error('Intralys Webchat: attribut data-client manquant sur la balise script.');
    return;
  }

  // Déterminer la base URL (prod ou dev)
  var scriptSrc = scriptTag ? scriptTag.getAttribute('src') : '';
  var urlObj = scriptSrc ? new URL(scriptSrc, window.location.href) : { origin: 'http://localhost:5174' };
  var apiBase = urlObj.origin;

  // Création des styles
  var style = document.createElement('style');
  style.textContent = `
    #intralys-chat-bubble {
      position: fixed; bottom: 20px; right: 20px; width: 60px; height: 60px; 
      border-radius: 50%; background: linear-gradient(135deg, #009DDB, #0077A8); 
      color: white; border: none; cursor: pointer; font-size: 24px; 
      box-shadow: 0 4px 20px rgba(0, 157, 219, 0.4); z-index: 2147483647; 
      transition: transform 0.2s ease, box-shadow 0.2s ease; 
      display: flex; align-items: center; justify-content: center;
    }
    #intralys-chat-bubble:hover {
      transform: scale(1.1);
      box-shadow: 0 6px 24px rgba(0, 157, 219, 0.6);
    }
    #intralys-chat-iframe {
      position: fixed; bottom: 90px; right: 20px; width: 380px; height: 600px; 
      max-height: calc(100vh - 120px); border: none; border-radius: 16px; 
      box-shadow: 0 8px 40px rgba(0,0,0,0.2); z-index: 2147483647; 
      display: none; transition: opacity 0.3s ease, transform 0.3s ease;
      opacity: 0; transform: translateY(20px); pointer-events: none;
    }
    #intralys-chat-iframe.intralys-open {
      display: block; opacity: 1; transform: translateY(0); pointer-events: all;
    }
    
    @media (max-width: 480px) {
      #intralys-chat-iframe {
        width: calc(100vw - 40px);
        right: 20px;
      }
    }
  `;
  document.head.appendChild(style);

  // Bouton flottant
  var bubble = document.createElement('button');
  bubble.id = 'intralys-chat-bubble';
  bubble.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
    </svg>
  `;
  document.body.appendChild(bubble);

  // Iframe sandboxée
  var iframe = document.createElement('iframe');
  iframe.id = 'intralys-chat-iframe';
  iframe.src = apiBase + '/widget/frame.html?client_id=' + encodeURIComponent(clientId);
  iframe.allow = "microphone; camera";
  document.body.appendChild(iframe);

  // Toggle affichage
  var isOpen = false;
  bubble.onclick = function() {
    isOpen = !isOpen;
    if (isOpen) {
      iframe.classList.add('intralys-open');
      bubble.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      `;
    } else {
      iframe.classList.remove('intralys-open');
      bubble.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
        </svg>
      `;
    }
  };

  // Écouter les messages de l'iframe pour la fermeture ou autre
  window.addEventListener('message', function(event) {
    // Valider l'origine en prod, ici on laisse ouvert pour le dev
    if (event.data === 'intralys_close_widget') {
      isOpen = false;
      iframe.classList.remove('intralys-open');
      bubble.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
        </svg>
      `;
    }
  });
})();
