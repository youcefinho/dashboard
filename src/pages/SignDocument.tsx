import { useState, useEffect, useRef } from 'react';
import { useParams } from '@tanstack/react-router';
import { apiFetch, declinePublicDocument } from '@/lib/api';
import { Button, Card, Tag, Input, useToast, useConfirm, Icon } from '@/components/ui';
import { PenTool, CheckCircle, Shield, AlertTriangle, XCircle } from 'lucide-react';
import SignatureCanvas from 'react-signature-canvas';
import { t } from '@/lib/i18n';

interface PublicDocument {
  id: string;
  title: string;
  body_html: string;
  status: 'draft' | 'sent' | 'viewed' | 'signed' | 'expired';
}

export function SignDocumentPage() {
  const { warning } = useToast();
  const confirm = useConfirm();
  const { token } = useParams({ strict: false }) as { token: string };
  const [doc, setDoc] = useState<PublicDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSigning, setIsSigning] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [isDeclined, setIsDeclined] = useState(false);
  const [isDeclining, setIsDeclining] = useState(false);
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
      warning(t('sign.warn.no_sig'));
      return;
    }

    if (!signerName.trim()) {
      warning(t('sign.warn.no_name'));
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

  // ── Sprint 17 PROPOSALS E-SIGN — refus public ──
  // Confirmation puis declinePublicDocument(token, { reason }) (helper FIGÉ
  // Phase A, calque l'appel public de signature). Best-effort — au succès,
  // écran "refusé". Le flux de signature existant reste intact.
  const handleDecline = async () => {
    const ok = await confirm({
      title: t('sign.decline'),
      description: t('sign.decline_confirm'),
      confirmLabel: t('sign.decline'),
    });
    if (!ok) return;

    setIsDeclining(true);
    try {
      const reason = signerName.trim();
      const res = await declinePublicDocument(token, reason ? { reason } : {});
      if (res.error) {
        setError(res.error);
      } else {
        setIsDeclined(true);
      }
    } catch (e: any) {
      setError(e.message || 'Erreur lors du refus.');
    } finally {
      setIsDeclining(false);
    }
  };

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg-canvas)] p-4">
        <Card className="max-w-md w-full p-8 text-center border-[var(--danger)]">
          <Icon as={AlertTriangle} size={48} className="mx-auto text-[var(--danger)] mb-4" />
          <h1 className="text-xl font-bold mb-2 text-[var(--danger)]">{t('sign.error.title')}</h1>
          <p className="text-[var(--text-secondary)]">{error}</p>
        </Card>
      </div>
    );
  }

  if (isSuccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg-canvas)] p-4">
        <Card className="max-w-md w-full p-8 text-center border-[var(--success)] shadow-lg">
          <Icon as={CheckCircle} size={64} className="mx-auto text-[var(--success)] mb-4" />
          <h1 className="text-2xl font-bold mb-2">{t('sign.success.title')}</h1>
          <p className="text-[var(--text-secondary)] mb-6">
            {t('sign.success.desc')}
          </p>
          <div className="p-4 bg-[var(--bg-subtle)] rounded-[var(--radius-md)] flex items-center justify-center gap-2 text-sm text-[var(--text-muted)]">
            <Icon as={Shield} size="md" /> {t('sign.success.certified')}
          </div>
        </Card>
      </div>
    );
  }

  if (isDeclined) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg-canvas)] p-4">
        <Card className="max-w-md w-full p-8 text-center border-[var(--danger)] shadow-lg">
          <Icon as={XCircle} size={64} className="mx-auto text-[var(--danger)] mb-4" />
          <h1 className="text-2xl font-bold">{t('proposal.declined')}</h1>
        </Card>
      </div>
    );
  }

  if (!doc) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg-canvas)]">
        <div className="animate-pulse text-[var(--text-muted)]">{t('sign.loading')}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center p-4 sm:p-8 relative overflow-hidden"
      style={{ background: 'linear-gradient(135deg, #FFFFFF 0%, #FAFBFC 35%, #F0FAFE 70%, #FFF1DD 100%)' }}>
      {/* Orbs décoratifs */}
      <div className="hero-stat-orb absolute w-[600px] h-[600px] rounded-full -top-60 -right-60 pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(0,157,219,0.22) 0%, transparent 70%)', filter: 'blur(60px)' }} />
      <div className="hero-stat-orb absolute w-[400px] h-[400px] rounded-full -bottom-40 -left-40 pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(217,110,39,0.18) 0%, transparent 70%)', filter: 'blur(60px)', animationDelay: '3s' }} />

      {/* Header bar Sprint 23 */}
      <div className="relative w-full max-w-4xl flex justify-between items-center mb-6 z-10">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center font-bold text-base"
            style={{
              background: 'linear-gradient(135deg, #009DDB 0%, #D96E27 100%)',
              boxShadow: '0 4px 12px rgba(0,157,219,0.4)',
              color: 'white',
            }}>I</div>
          <div className="text-xl font-bold tracking-tight">
            <span className="text-gradient-brand">INTRALYS</span>
          </div>
        </div>
        <Tag variant="brand" size="sm">{t('sign.pending')}</Tag>
      </div>

      <div className="relative w-full max-w-4xl rounded-2xl overflow-hidden flex flex-col md:flex-row z-10"
        style={{
          background: 'rgba(255,255,255,0.95)',
          backdropFilter: 'blur(12px) saturate(160%)',
          WebkitBackdropFilter: 'blur(12px) saturate(160%)',
          border: '1px solid var(--border-subtle)',
          boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 24px 64px -12px rgba(0,157,219,0.18)',
        }}>
        {/* Bandeau top — gradient brand 30% */}
        <div
          aria-hidden
          className="absolute top-0 left-0 right-0 h-[2px] z-10"
          style={{
            background: 'linear-gradient(90deg, rgba(0,157,219,0.85) 0%, rgba(217,110,39,0.85) 100%)',
            boxShadow: '0 0 14px -2px rgba(0,157,219,0.45)',
          }}
        />
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
              <Icon as={PenTool} size={18} /> {t('sign.panel.title')}
            </h3>
            <p className="text-xs text-[var(--text-muted)]">{t('sign.panel.desc')}</p>
          </div>

          <div className="space-y-4 flex-1">
            <div>
              <label className="block text-sm font-medium mb-1">{t('sign.panel.name')}</label>
              <Input
                type="text"
                placeholder="Ex: Jean Dupont"
                value={signerName}
                onChange={e => setSignerName(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">{t('sign.panel.signature')}</label>
              <div className="border border-[var(--border-default)] rounded bg-white overflow-hidden touch-none relative">
                <SignatureCanvas 
                  ref={sigCanvas} 
                  penColor="black"
                  canvasProps={{ width: 500, height: 200, className: 'w-full h-48 cursor-crosshair' }} 
                />
                <button 
                  onClick={clearSignature}
                  className="absolute bottom-2 right-2 text-xs bg-[var(--bg-subtle)] px-2 py-1 rounded hover:bg-[var(--bg-muted)] text-[var(--text-secondary)]"
                >
                  {t('sign.panel.clear')}
                </button>
              </div>
            </div>
            
            <div className="text-xs text-[var(--text-muted)] flex items-start gap-1.5 p-3 bg-[var(--bg-subtle)] rounded">
              <Icon as={Shield} size="sm" className="shrink-0 mt-0.5 text-[var(--primary)]" />
              <p>Votre adresse IP et la date de signature seront enregistrées pour garantir l'authenticité de ce document (Loi 25).</p>
            </div>
          </div>

          <div className="mt-8 space-y-3">
            <Button
              className="w-full py-4 text-lg justify-center shadow-lg hover:shadow-xl transition-all"
              onClick={() => void handleSign()}
              disabled={isSigning || isDeclining}
            >
              {isSigning ? t('sign.panel.submitting') : t('sign.panel.submit')}
            </Button>
            <Button
              variant="secondary"
              className="w-full justify-center"
              onClick={() => void handleDecline()}
              disabled={isSigning || isDeclining}
            >
              <Icon as={XCircle} size="sm" /> {t('sign.decline')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
