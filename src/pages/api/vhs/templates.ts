import type { NextApiRequest, NextApiResponse } from 'next';
import { DEFAULT_VHS_TEMPLATE_ID, VHS_TEMPLATES } from '@/lib/vhs/templates';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ message: 'Method not allowed' });
  }

  return res.status(200).json({
    defaultTemplateId: DEFAULT_VHS_TEMPLATE_ID,
    templates: VHS_TEMPLATES.map((template) => ({
      id: template.id,
      name: template.name,
      output: template.output,
      poster: template.poster,
      overlayCount: template.overlays?.length ?? 0,
    })),
  });
}
