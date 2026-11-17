import React, { useState } from 'react';
import { Camera, ImagePlus, LoaderCircle, RotateCcw, Sparkles, Upload } from 'lucide-react';
import { apiUrl } from './api.js';

const maxImageSize = 3 * 1024 * 1024;

function VirtualTryOn() {
  const [person, setPerson] = useState(null);
  const [saree, setSaree] = useState(null);
  const [result, setResult] = useState('');
  const [error, setError] = useState('');
  const [generating, setGenerating] = useState(false);
  const [storageConsent, setStorageConsent] = useState(false);

  const readImage = (file, setter) => {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setter(null);
      setResult('');
      setError('Choose a JPG, PNG, or WebP image.');
      return;
    }
    if (file.size > maxImageSize) {
      setter(null);
      setResult('');
      setError('Each image must be smaller than 3 MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        setError('Unable to read that image. Please try another file.');
        return;
      }
      setter({ dataUrl: reader.result, name: file.name });
      setResult('');
      setError('');
    };
    reader.onerror = () => setError('Unable to read that image. Please try another file.');
    reader.readAsDataURL(file);
  };

  const generateTryOn = async event => {
    event.preventDefault();
    if (!person || !saree || !storageConsent) {
      setError('Add both images and agree to the photo storage notice to continue.');
      return;
    }

    setGenerating(true);
    setError('');
    setResult('');
    try {
      const response = await fetch(`${apiUrl}/try-on`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personImage: person.dataUrl, sareeImage: saree.dataUrl, storeConsent: storageConsent }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Try-on generation failed. Please try again.');
      if (typeof data.imageUrl !== 'string' || !data.imageUrl) {
        throw new Error('The AI service did not return an image. Please try again.');
      }
      setResult(data.imageUrl);
    } catch (requestError) {
      setError(requestError.message || 'Unable to reach the AI service. Please try again.');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <section className="tryon-section section-pad" id="try-on">
      <div className="tryon-heading">
        <div className="eyebrow"><span></span> YOUR LOOK, REIMAGINED <span></span></div>
        <h2>Try on a saree, <em>virtually.</em></h2>
        <p>Upload a full-length photo and the saree you love to create an AI-generated preview.</p>
      </div>
      <form className="tryon-layout" onSubmit={generateTryOn}>
        <div className="tryon-inputs">
          <label className="tryon-upload-card">
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={event => readImage(event.target.files?.[0], setPerson)} />
            {person ? <img src={person.dataUrl} alt="Your uploaded photo" /> : <span className="tryon-upload-empty"><Camera/><b>Upload your photo</b><small>Choose a clear, full-length photo</small><span className="tryon-upload-button"><Upload size={15}/> CHOOSE PHOTO</span></span>}
            {person && <span className="tryon-file-name">Change photo · {person.name}</span>}
          </label>
          <label className="tryon-upload-card">
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={event => readImage(event.target.files?.[0], setSaree)} />
            {saree ? <img src={saree.dataUrl} alt="Uploaded saree" /> : <span className="tryon-upload-empty"><ImagePlus/><b>Upload a saree image</b><small>Use a clear photo of the complete saree</small><span className="tryon-upload-button"><Upload size={15}/> CHOOSE SAREE</span></span>}
            {saree && <span className="tryon-file-name">Change saree · {saree.name}</span>}
          </label>
          <div className="tryon-submit">
            {error && <p className="tryon-error" role="alert">{error}</p>}
            <label className="tryon-consent"><input type="checkbox" checked={storageConsent} onChange={event => { setStorageConsent(event.target.checked); setError(''); }} />I agree to store my uploaded photo, the saree image, and the generated preview in the store's admin-only try-on history for up to 30 days. Images are also sent to Cloudflare Workers AI for generation.</label>
            <button className="gold-btn" type="submit" disabled={generating || !person || !saree || !storageConsent}>
              {generating ? <><LoaderCircle className="tryon-spinner" size={16}/> CREATING YOUR PREVIEW</> : <><Sparkles size={16}/> SEE IT ON ME</>}
            </button>
            <p className="tryon-privacy">Use only photos you have permission to share. Use Cloudflare's free plan to avoid charges; daily usage is limited.</p>
          </div>
        </div>
        <div className={`tryon-result ${result ? 'has-result' : ''}`} aria-live="polite">
          {result ? <><img src={result} alt="AI-generated saree try-on preview" /><a className="outline-btn" href={result} target="_blank" rel="noreferrer">OPEN PREVIEW <RotateCcw size={14}/></a></> : <div className="tryon-result-empty"><Sparkles/><b>{generating ? 'Creating your look…' : 'Your preview will appear here'}</b><small>{generating ? 'This can take a little while.' : 'Add both images to get started.'}</small></div>}
        </div>
      </form>
      <p className="tryon-disclaimer">AI-generated visualization only. Saree colors, drape, and fit may differ from the actual garment.</p>
    </section>
  );
}

export default VirtualTryOn;
