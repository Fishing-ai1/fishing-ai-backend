export function riskSignals(text: string) {
  const flags: { reason: string; confidence: number; severity: string }[] = [];
  if(/(?:ignore|override).{0,35}(?:instructions|system prompt)|reveal.{0,30}(?:api key|system prompt|secret)/is.test(text)) flags.push({ reason:'Possible prompt injection',confidence:0.7,severity:'medium' });
  if(/(?:seed phrase|recovery phrase|send.{0,20}(?:password|verification code))|(?:guaranteed|risk.free).{0,30}(?:profit|return)/is.test(text)) flags.push({ reason:'Possible phishing or scam',confidence:0.75,severity:'high' });
  if((text.match(/https?:\/\//g)||[]).length>8) flags.push({reason:'Unusually high link count',confidence:0.6,severity:'low'});
  return flags;
}
export async function flagContent(db: any, gateway: any, input: { userId: string; targetType: string; targetId: string; text: string }) {
  const flags=riskSignals(input.text);
  try {
    const result=await gateway.moderate(input.text);
    if(result.flagged) {
      const categories=Object.keys(result.categories).filter(k=>result.categories[k]);
      const confidence=Math.max(0,...categories.map(k=>Number(result.scores[k] || 0)));
      flags.push({reason:'Content moderation: '+categories.join(', '),confidence,severity:confidence>0.95?'high':'medium'});
    }
  } catch { flags.push({reason:'Moderation provider unavailable; manual review required',confidence:0,severity:'low'}); }
  if(!flags.length)return;
  const rows=flags.map(f=>({user_id:input.userId,target_type:input.targetType,target_id:input.targetId,...f,detector:'oceancore-rules-v1 / '+gateway.config.moderation}));
  const result=await db.from('oc_moderation').insert(rows);
  if(result.error)throw Object.assign(new Error('Moderation review could not be recorded. Please retry.'),{statusCode:503});
  // Classification creates review work; it never changes account status or bans a user.
}
