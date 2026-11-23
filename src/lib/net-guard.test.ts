import { describe, expect, it } from 'vitest';
import { embeddedIPv4, ipv6ToHextets, isBlockedAddress, pinnedLookup, resolvePublicAddress, safeFetch } from './net-guard';

describe('isBlockedAddress — IPv4', () => {
  it.each(['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255'])(
    'bloqueia %s',
    (ip) => expect(isBlockedAddress(ip)).toBe(true),
  );
  it.each(['8.8.8.8', '1.1.1.1', '172.32.0.1', '93.184.216.34'])('permite %s', (ip) => expect(isBlockedAddress(ip)).toBe(false));
});

describe('isBlockedAddress — IPv6 e formas "disfarçadas" (bypass da revisão)', () => {
  it.each([
    ['::ffff:7f00:1', 'IPv4-mapeado em hex = 127.0.0.1'],
    ['::ffff:127.0.0.1', 'IPv4-mapeado em decimal'],
    ['::ffff:a9fe:a9fe', 'mapeado = 169.254.169.254 (metadata)'],
    ['::ffff:[a9fe:a9fe]'.replace(/[[\]]/g, ''), 'mesmo caso sem colchetes'],
    ['64:ff9b::7f00:1', 'NAT64 → 127.0.0.1'],
    ['64:ff9b::a9fe:a9fe', 'NAT64 → 169.254.169.254'],
    ['64:ff9b::10.0.0.1', 'NAT64 em notação decimal → 10.0.0.1'],
    ['64:ff9b:1:7f00:0:100::', 'NAT64 local-use /48 (RFC 8215) → 127.0.0.1'],
    ['64:ff9b:1:a9fe:a9:fe00::', 'NAT64 local-use /48 → 169.254.169.254'],
    ['::ffff:0:7f00:1', 'IPv4-translated (SIIT) → 127.0.0.1'],
    ['::ffff:0:a9fe:a9fe', 'IPv4-translated → 169.254.169.254'],
    ['2002:7f00:1::', '6to4 → 127.0.0.1'],
    ['::127.0.0.1', 'IPv4-compatível'],
    ['::1', 'loopback'],
    ['::', 'não especificado'],
    ['fe80::1', 'link-local'],
    ['febf::1', 'fe80::/10 (limite superior)'],
    ['fec0::1', 'site-local obsoleto'],
    ['fc00::1', 'ULA'],
    ['fd12:3456::1', 'ULA'],
    ['ff02::1', 'multicast'],
    ['2001:0:4136:e378:8000:63bf:3fff:fdd2', 'Teredo'],
    ['2001:db8::1', 'documentação'],
    ['fe80::1%eth0', 'com zona'],
  ])('bloqueia %s (%s)', (ip) => expect(isBlockedAddress(ip)).toBe(true));

  it.each(['2606:4700:4700::1111', '2001:4860:4860::8888', '::ffff:8.8.8.8', '64:ff9b::808:808', '64:ff9b:1:808:8:800::', '::ffff:0:808:808'])('permite %s', (ip) =>
    expect(isBlockedAddress(ip)).toBe(false),
  );

  it('recusa entradas que não são IP', () => {
    expect(isBlockedAddress('não-é-ip')).toBe(true);
    expect(isBlockedAddress('1.2.3')).toBe(true);
  });

  it('interpreta corretamente a sintaxe IPv6', () => {
    expect(ipv6ToHextets('::1')).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(ipv6ToHextets('::ffff:1.2.3.4')).toEqual([0, 0, 0, 0, 0, 0xffff, 0x0102, 0x0304]);
    expect(embeddedIPv4(ipv6ToHextets('::ffff:a9fe:a9fe')!)).toBe('169.254.169.254');
    expect(ipv6ToHextets('1:2:3')).toBeNull();
  });
});

describe('resolvePublicAddress — DNS rebinding', () => {
  const answers = (list: string[]) => async () => list.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));

  it('aceita nome que resolve só para IPs públicos e devolve o IP a fixar', async () => {
    await expect(resolvePublicAddress('exemplo.com', answers(['93.184.216.34']))).resolves.toEqual({ address: '93.184.216.34', family: 4 });
  });

  it('recusa quando QUALQUER resposta é interna (resposta mista = rebinding)', async () => {
    await expect(resolvePublicAddress('rebind.test', answers(['93.184.216.34', '127.0.0.1']))).rejects.toThrow(/rede interna/);
    await expect(resolvePublicAddress('rebind.test', answers(['8.8.8.8', '::ffff:a9fe:a9fe']))).rejects.toThrow(/rede interna/);
  });

  it('recusa IP literal interno e nome que não resolve', async () => {
    await expect(resolvePublicAddress('127.0.0.1')).rejects.toThrow(/rede interna/);
    await expect(resolvePublicAddress('[::1]')).rejects.toThrow(/rede interna/);
    await expect(resolvePublicAddress('nada.test', async () => [])).rejects.toThrow(/resolver/);
  });

  it('o lookup fixado ignora qualquer resolução posterior (a conexão usa só o IP validado)', () => {
    const lookup = pinnedLookup('93.184.216.34', 4);
    let single: unknown[] = [];
    lookup('rebind.test', {}, (...args) => (single = args));
    expect(single).toEqual([null, '93.184.216.34', 4]);
    let all: unknown[] = [];
    lookup('rebind.test', { all: true }, (...args) => (all = args));
    expect(all).toEqual([null, [{ address: '93.184.216.34', family: 4 }]]);
  });
});

describe('safeFetch', () => {
  it('recusa protocolos, credenciais e destinos internos antes de qualquer conexão', async () => {
    await expect(safeFetch('ftp://exemplo.com/a.mp4')).rejects.toThrow(/http/);
    await expect(safeFetch('http://user:senha@exemplo.com/a.mp4', { lookup: async () => [{ address: '93.184.216.34', family: 4 }] })).rejects.toThrow(/usuário e senha/);
    await expect(safeFetch('http://127.0.0.1:3000/x.mp4')).rejects.toThrow(/rede interna/);
    await expect(safeFetch('http://[::ffff:7f00:1]/x.mp4')).rejects.toThrow(/rede interna/);
    await expect(safeFetch('http://metadata.test/latest', { lookup: async () => [{ address: '::ffff:a9fe:a9fe', family: 6 }] })).rejects.toThrow(/rede interna/);
    await expect(safeFetch('não é url')).rejects.toThrow(/inválida/);
  });
});
