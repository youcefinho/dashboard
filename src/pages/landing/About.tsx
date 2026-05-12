import { PublicLayout } from './PublicLayout';

export function AboutPage() {
  return (
    <PublicLayout>
      <div className="pt-20 pb-24 px-4 sm:px-6 lg:px-8 max-w-3xl mx-auto">
        <h1 className="text-4xl font-extrabold text-slate-900 mb-8 text-center">À propos d'Intralys</h1>
        
        <div className="prose prose-slate max-w-none">
          <p className="text-lg text-slate-600 leading-relaxed mb-6">
            Intralys est née d'un constat simple : les PMEs francophones ont besoin d'outils puissants, mais les CRM existants (GoHighLevel, HubSpot, Salesforce) sont souvent trop complexes, trop chers, ou inadaptés à la réalité locale.
          </p>
          
          <h2 className="text-2xl font-bold text-slate-900 mt-12 mb-4">Notre Mission</h2>
          <p className="text-slate-600 leading-relaxed mb-6">
            Démocratiser l'automatisation et la gestion de la relation client pour les courtiers, les cliniques, les coachs et les entreprises de services locaux. Nous croyons qu'une PME ne devrait pas avoir besoin d'une équipe technique pour automatiser ses suivis et convertir ses leads.
          </p>

          <h2 className="text-2xl font-bold text-slate-900 mt-12 mb-4">L'Équipe</h2>
          <div className="bg-slate-50 border border-slate-100 rounded-2xl p-8 flex flex-col sm:flex-row gap-8 items-center mt-6">
            <div className="w-32 h-32 bg-slate-200 rounded-full shrink-0"></div>
            <div>
              <h3 className="text-xl font-bold text-slate-900">Rochdi Dahmani</h3>
              <p className="text-[var(--brand-primary)] font-medium mb-4">Fondateur</p>
              <p className="text-slate-600 text-sm">
                Développeur et entrepreneur, Rochdi a créé Intralys pour offrir une alternative moderne, performante et 100% francophone aux solutions américaines complexes.
              </p>
            </div>
          </div>
        </div>
      </div>
    </PublicLayout>
  );
}
