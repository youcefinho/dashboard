import { useEffect, useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { Button, Card } from '@/components/ui';
import React from 'react';

type Field = {
  id: string;
  type: string;
  name: string;
  label: string;
  required?: boolean;
  placeholder?: string;
  options?: Array<{ label: string; value: string }>;
};

type FormConfig = {
  id: string;
  name: string;
  description: string;
  fields: string;
  submit_action: string;
  success_message: string;
  form_type: string;
  settings_json: string;
};

export function PublicFormPage() {
  const { slug } = useParams({ strict: false }) as { slug: string };
  const [config, setConfig] = useState<FormConfig | null>(null);
  const [fields, setFields] = useState<Field[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<{
    success: boolean;
    message: string;
    quiz_score?: number;
    quiz_result?: { range: string; message: string };
  } | null>(null);

  useEffect(() => {
    if (!slug) return;
    fetch(`/api/form/${slug}`)
      .then(res => res.json())
      .then((data: any) => {
        if (data.error) throw new Error(data.error);
        setConfig(data.data);
        try { setFields(JSON.parse(data.data.fields || '[]')); } catch { setFields([]); }
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [slug]);

  // ResizeObserver pour informer l'iframe parent (f.js)
  useEffect(() => {
    const resizeObserver = new ResizeObserver(entries => {
      for (let entry of entries) {
        window.parent.postMessage(JSON.stringify({
          type: 'intralys-form-resize',
          slug: slug,
          height: entry.target.scrollHeight
        }), '*');
      }
    });
    resizeObserver.observe(document.body);
    return () => resizeObserver.disconnect();
  }, [slug]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!config) return;
    setIsSubmitting(true);
    
    try {
      const res = await fetch('/api/form/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ form_id: config.id, data: formData })
      });
      const data = (await res.json()) as any;
      
      if (!res.ok) throw new Error(data.error || 'Erreur lors de la soumission');
      
      setSubmitResult({
        success: true,
        message: data.data.success_message || config.success_message || 'Merci pour votre demande !',
        quiz_score: data.data.quiz_score,
        quiz_result: data.data.quiz_result,
      });

      if (data.data.redirect_url) {
        setTimeout(() => { window.top!.location.href = data.data.redirect_url; }, 2000);
      }

    } catch (err: any) {
      alert(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFieldChange = (name: string, value: any) => {
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-transparent">
        <div style={{ width: 36, height: 36, border: '3px solid rgba(0,157,219,0.2)', borderTopColor: 'var(--brand-primary, #009DDB)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      </div>
    );
  }
  if (error) return <div className="p-6 text-center text-red-500">{error}</div>;
  if (!config) return <div className="p-6 text-center">Formulaire introuvable</div>;

  if (submitResult?.success) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-transparent font-inter">
        <Card className="w-full max-w-md text-center p-8 border-none shadow-none bg-transparent">
          <div className="w-16 h-16 bg-green-50 text-green-500 rounded-full flex items-center justify-center mx-auto mb-4 text-2xl">✓</div>
          <h2 className="text-xl font-bold mb-2 text-gray-900">Succès</h2>
          <p className="text-gray-500 whitespace-pre-wrap">{submitResult.message}</p>
          
          {submitResult.quiz_result && (
            <div className="mt-6 p-4 rounded-xl bg-blue-50 text-left">
              <p className="text-sm font-semibold text-blue-600 mb-1">Votre résultat :</p>
              <p className="text-gray-900">{submitResult.quiz_result.message}</p>
            </div>
          )}
        </Card>
      </div>
    );
  }

  const inputClasses = "w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";
  const labelClasses = "mb-1 block text-sm font-medium text-gray-700";

  return (
    <div className="min-h-screen bg-transparent p-4 flex justify-center items-start font-inter">
      <Card className="w-full max-w-lg border-none shadow-none bg-transparent">
        <div className="p-6">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">{config.name}</h1>
          {config.description && <p className="text-gray-500 mb-6 text-sm">{config.description}</p>}
          
          <form onSubmit={handleSubmit} className="space-y-5">
            {fields.map(f => {
              switch (f.type) {
                case 'text':
                case 'email':
                case 'phone':
                  return (
                    <div key={f.id}>
                      <label className={labelClasses}>
                        {f.label} {f.required && <span className="text-red-500">*</span>}
                      </label>
                      <input
                        type={f.type === 'phone' ? 'tel' : f.type}
                        placeholder={f.placeholder}
                        required={f.required}
                        value={formData[f.name] || ''}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleFieldChange(f.name, e.target.value)}
                        className={inputClasses}
                      />
                    </div>
                  );
                case 'textarea':
                  return (
                    <div key={f.id}>
                      <label className={labelClasses}>
                        {f.label} {f.required && <span className="text-red-500">*</span>}
                      </label>
                      <textarea
                        placeholder={f.placeholder}
                        required={f.required}
                        value={formData[f.name] || ''}
                        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => handleFieldChange(f.name, e.target.value)}
                        rows={4}
                        className={inputClasses}
                      />
                    </div>
                  );
                case 'select':
                  return (
                    <div key={f.id}>
                      <label className={labelClasses}>
                        {f.label} {f.required && <span className="text-red-500">*</span>}
                      </label>
                      <select
                        required={f.required}
                        value={formData[f.name] || ''}
                        onChange={(e: React.ChangeEvent<HTMLSelectElement>) => handleFieldChange(f.name, e.target.value)}
                        className={inputClasses}
                      >
                        <option value="">Sélectionnez...</option>
                        {f.options?.map(opt => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </div>
                  );
                case 'radio':
                  return (
                    <div key={f.id} className="space-y-2">
                      <label className={labelClasses}>
                        {f.label} {f.required && <span className="text-red-500">*</span>}
                      </label>
                      <div className="space-y-2">
                        {f.options?.map((opt, i) => (
                          <label key={i} className="flex items-center gap-3 cursor-pointer p-3 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors">
                            <input
                              type="radio"
                              name={f.name}
                              value={opt.value}
                              required={f.required}
                              checked={formData[f.name] === opt.value}
                              onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleFieldChange(f.name, e.target.value)}
                              className="text-blue-600 focus:ring-blue-500"
                            />
                            <span className="text-sm font-medium text-gray-900">{opt.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                case 'checkbox':
                  return (
                    <div key={f.id} className="pt-2 flex items-center gap-2">
                      <input
                        type="checkbox"
                        id={f.id}
                        required={f.required}
                        checked={formData[f.name] || false}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleFieldChange(f.name, e.target.checked)}
                        className="rounded text-blue-600 focus:ring-blue-500 h-4 w-4"
                      />
                      <label htmlFor={f.id} className="text-sm font-medium text-gray-700">
                        {f.label} {f.required && <span className="text-red-500">*</span>}
                      </label>
                    </div>
                  );
                default:
                  return <div key={f.id} className="text-sm text-red-500">Champ non supporté : {f.type}</div>;
              }
            })}
            
            <div className="pt-4">
              <Button type="submit" variant="primary" className="w-full text-base py-3" isLoading={isSubmitting}>
                {config.form_type === 'quiz' ? 'Voir mon résultat' : 'Soumettre'}
              </Button>
            </div>
            
            <p className="text-center text-[10px] text-gray-400 pt-2">
              Propulsé par <strong>Intralys</strong>
            </p>
          </form>
        </div>
      </Card>
    </div>
  );
}
