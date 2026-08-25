export interface NormalizedGeo {
  geo_country: string | null;
  geo_region: string | null;
  geo_region_code: string | null;
  geo_city: string | null;
  geo_lat: number | null;
  geo_lon: number | null;
  geo_timezone: string | null;
  geo_continent: string | null;
  asn: number | null;
  as_org: string | null;
  cf_colo: string | null;
  egress_ip: string | null;
  edge_rtt_ms: number | null;
  edge_transport: 'quic' | 'tcp' | null;
}

export function extractCloudflareMetadata(request: Request): NormalizedGeo {
  // Extract CF metadata if available
  const cf = (request as unknown as { cf?: IncomingRequestCfProperties }).cf;
  const clientIp = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || null;

  let geo_lat: number | null = null;
  let geo_lon: number | null = null;

  if (cf?.latitude) {
    const parsed = typeof cf.latitude === 'number' ? cf.latitude : parseFloat(cf.latitude);
    if (!isNaN(parsed) && parsed >= -90 && parsed <= 90) {
      geo_lat = Math.round(parsed * 10000) / 10000;
    }
  }

  if (cf?.longitude) {
    const parsed = typeof cf.longitude === 'number' ? cf.longitude : parseFloat(cf.longitude);
    if (!isNaN(parsed) && parsed >= -180 && parsed <= 180) {
      geo_lon = Math.round(parsed * 10000) / 10000;
    }
  }

  let edge_rtt_ms: number | null = null;
  let edge_transport: 'quic' | 'tcp' | null = null;

  if (cf?.clientQuicRtt && cf.clientQuicRtt > 0) {
    edge_rtt_ms = Math.round(cf.clientQuicRtt * 10) / 10;
    edge_transport = 'quic';
  } else if (cf?.clientTcpRtt && cf.clientTcpRtt > 0) {
    edge_rtt_ms = Math.round(cf.clientTcpRtt * 10) / 10;
    edge_transport = 'tcp';
  }

  return {
    geo_country: cf?.country || null,
    geo_region: cf?.region || null,
    geo_region_code: cf?.regionCode || null,
    geo_city: cf?.city || null,
    geo_lat,
    geo_lon,
    geo_timezone: cf?.timezone || null,
    geo_continent: cf?.continent || null,
    asn: cf?.asn ? Number(cf.asn) : null,
    as_org: cf?.asOrganization || null,
    cf_colo: cf?.colo || null,
    egress_ip: clientIp,
    edge_rtt_ms,
    edge_transport,
  };
}
