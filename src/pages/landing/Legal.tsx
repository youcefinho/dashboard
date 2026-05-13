import { PublicLayout } from './PublicLayout';

export function LegalPage({ type }: { type: 'privacy' | 'terms' }) {
  return (
    <PublicLayout>
      <div className="pt-20 pb-24 px-4 sm:px-6 lg:px-8 max-w-3xl mx-auto">
        <h1 className="text-4xl font-extrabold text-[var(--text-primary)] mb-8">
          {type === 'privacy' ? 'Politique de Confidentialité' : "Conditions d'Utilisation"}
        </h1>
        
        <div className="prose prose-slate max-w-none">
          <p className="text-[var(--text-muted)] text-sm mb-8">Dernière mise à jour : {new Date().toLocaleDateString('fr-CA')}</p>
          
          {type === 'privacy' ? (
            <>
              <h2>1. Conformité Loi 25</h2>
              <p>Conformément à la Loi 25 du Québec, Intralys s'engage à protéger les renseignements personnels de ses utilisateurs et de leurs clients. Le Responsable de la protection des renseignements personnels est Rochdi Dahmani.</p>
              
              <h2>2. Collecte des données</h2>
              <p>Nous collectons uniquement les informations nécessaires au bon fonctionnement du CRM : nom, courriel, téléphone, et les données de vos prospects (leads) que vous choisissez d'importer ou de générer.</p>

              <h2>3. Hébergement et Sécurité</h2>
              <p>Les données sont hébergées de manière sécurisée via l'infrastructure Cloudflare (D1, Workers). Des mesures de chiffrement et de contrôle d'accès stricts sont en place.</p>
            </>
          ) : (
            <>
              <h2>1. Acceptation des conditions</h2>
              <p>En utilisant Intralys CRM, vous acceptez les présentes conditions d'utilisation.</p>
              
              <h2>2. Utilisation du service</h2>
              <p>Vous êtes responsable de maintenir la confidentialité de votre compte et de votre mot de passe. Le service est fourni "tel quel" sans garantie implicite de revenus ou de résultats commerciaux.</p>

              <h2>3. Résiliation</h2>
              <p>Vous pouvez annuler votre abonnement à tout moment. Les données associées à votre compte seront conservées pendant 30 jours après résiliation avant d'être définitivement supprimées.</p>
            </>
          )}
        </div>
      </div>
    </PublicLayout>
  );
}
