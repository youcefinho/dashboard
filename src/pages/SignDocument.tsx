import { useState, useEffect, useRef } from 'react';
import { useParams } from '@tanstack/react-router';
import { apiFetch } from '@/lib/api';
import { Button, Card, Badge } from '@/components/ui';
import { PenTool, CheckCircle, Shield, AlertTriangle } from 'lucide-react';
import SignatureCanvas from 'react-signature-canvas';

interface PublicDocument {
  id: string;
  title: string;
  body_html: string;
  status: 'draft' | 'sent' | 'viewed' | 'signed' | 'expired';
}

export function SignDocumentPage() {
  const { token } = useParams({ strict: false }) as { token: string };
  const [doc, setDoc] = useState<PublicDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSigning, setIsSigning] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [signerName, setSignerName] = useState('');
  
  const sigCanvas = useRef<any>(null);

  useEffect(() => {
    if (!token) return;
    
    // Load document details
    apiFetch<PublicDocument>(`/sign/${token}`)
      .then(res => {
        if (res.error) setError(res.error);
        else setDoc(res.data || null);
      })
      .catch(e => setError(e.message || 'Erreur lors du chargement du document.'));
  }, [token]);

  const clearSignature = () => {
    if (sigCanvas.current) {
      sigCanvas.current.clear();
    }
  };

  const handleSign = async () => {
    if (!sigCanvas.current || sigCanvas.current.isEmpty()) {
      alert('Veuillez signer le document avant de soumettre.');
      return;
    }
    
    if (!signerName.trim()) {
      alert('Veuillez entrer votre nom.');
      return;
    }

    setIsSigning(true);
    const signatureData = sigCanvas.current.getTrimmedCanvas().toDataURL('image/png');

    try {
      const res = await apiFetch(`/sign/${token}`, {
        method: 'POST',
        body: JSON.stringify({ signature: signatureData, signer_name: signerName.trim() })
      });
      
      if (res.error) {
        setError(res.error);
      } else {
        setIsSuccess(true);
      }
    } catch (e: any) {
      setError(e.message || 'Erreur lors de la signature.');
    } finally {
      setIsSigning(false);
    }
  };

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg-canvas)] p-4">
        <Card className="max-w-md w-full p-8 text-center border-[var(--danger)]">
          <AlertTriangle size={48} className="mx-auto text-[var(--danger)] mb-4" />
          <h1 className="text-xl font-bold mb-2 text-[var(--danger)]">Document indisponible</h1>
          <p className="text-[var(--text-secondary)]">{error}</p>
        </Card>
      </div>
    );
  }

  if (isSuccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg-canvas)] p-4">
        <Card className="max-w-md w-full p-8 text-center border-[var(--success)] shadow-lg">
          <CheckCircle size={64} className="mx-auto text-[var(--success)] mb-4" />
          <h1 className="text-2xl font-bold mb-2">Document Signé !</h1>
          <p className="text-[var(--text-secondary)] mb-6">
            Merci. Votre signature a été enregistrée avec succès de manière sécurisée. Vous pouvez maintenant fermer cette page.
          </p>
          <div className="p-4 bg-[var(--bg-subtle)] rounded-[var(--radius-md)] flex items-center justify-center gap-2 text-sm text-[var(--text-muted)]">
            <Shield size={16} /> Signature certifiée & cryptée
          </div>
        </Card>
      </div>
    );
  }

  if (!doc) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg-canvas)]">
        <div className="animate-pulse text-[var(--text-muted)]">Chargement sécurisé du document...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg-canvas)] flex flex-col items-center p-4 sm:p-8">
      {/* Header bar */}
      <div className="w-full max-w-4xl flex justify-between items-center mb-6">
        <div className="text-xl font-bold text-[var(--brand-primary)]">INTRALYS</div>
        <Badge color="var(--brand-primary)">En attente de signature</Badge>
      </div>

      <div className="w-full max-w-4xl bg-white shadow-xl rounded-lg overflow-hidden flex flex-col md:flex-row">
        {/* Document Content */}
        <div className="flex-1 p-8 sm:p-12 overflow-y-auto max-h-[70vh] md:max-h-[85vh] border-b md:border-b-0 md:border-r border-[var(--border-subtle)]">
          <h1 className="text-2xl font-bold mb-8 text-black border-b pb-4">{doc.title}</h1>
          <div 
            className="prose prose-sm sm:prose-base max-w-none text-black"
            dangerouslySetInnerHTML={{ __html: doc.body_html }}
          />
        </div>

        {/* Signature Panel */}
        <div className="w-full md:w-96 bg-[var(--bg-surface)] p-6 flex flex-col">
          <div className="mb-6">
            <h3 className="font-bold text-lg flex items-center gap-2 mb-1">
              <PenTool size={18} /> Espace de signature
            </h3>
            <p className="text-xs text-[var(--text-muted)]">En signant, vous acceptez les termes de ce document.</p>
          </div>

          <div className="space-y-4 flex-1">
            <div>
              <label className="block text-sm font-medium mb-1">Votre nom complet</label>
              <input 
                type="text" 
                className="w-full p-2.5 bg-white border border-[var(--border-default)] rounded shadow-sm focus:outline-none focus:border-[var(--brand-primary)]"
                placeholder="Ex: Jean Dupont"
                value={signerName}
                onChange={e => setSignerName(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Signature</label>
              <div className="border border-[var(--border-default)] rounded bg-white overflow-hidden touch-none relative">
                <SignatureCanvas 
                  ref={sigCanvas} 
                  penColor="black"
                  canvasProps={{ width: 500, height: 200, className: 'w-full h-48 cursor-crosshair' }} 
                />
                <button 
                  onClick={clearSignature}
                  className="absolute bottom-2 right-2 text-xs bg-gray-100 px-2 py-1 rounded hover:bg-gray-200 text-gray-600"
                >
                  Effacer
                </button>
              </div>
            </div>
            
            <div className="text-xs text-[var(--text-muted)] flex items-start gap-1.5 p-3 bg-[var(--bg-subtle)] rounded">
              <Shield size={14} className="shrink-0 mt-0.5 text-[var(--brand-primary)]" />
              <p>Votre adresse IP et la date de signature seront enregistrées pour garantir l'authenticité de ce document (Loi 25).</p>
            </div>
          </div>

          <div className="mt-8">
            <Button 
              className="w-full py-4 text-lg justify-center shadow-lg hover:shadow-xl transition-all" 
              onClick={() => void handleSign()}
              disabled={isSigning}
            >
              {isSigning ? 'Signature en cours...' : 'Signer le document'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
