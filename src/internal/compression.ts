import { CompressionAdapter, CompressionKind } from '../types';

const HttpService = game.GetService('HttpService');

export interface EncodedPayload {
  readonly kind: CompressionKind;
  readonly data: unknown;
  readonly serializedBytes: number;
}

export function encodePayload(
  input: unknown,
  kind: CompressionKind,
  adapter?: CompressionAdapter,
): EncodedPayload {
  const serialized = HttpService.JSONEncode(input);
  const serializedBytes = string.byte(serialized, 1, -1).size();

  if (kind === 'none') {
    return {
      kind: 'none',
      data: input,
      serializedBytes,
    };
  }

  if (!adapter) {
    error(`Fossix compression '${kind}' requested without a compression adapter.`);
  }

  const compressedBuffer = adapter.compress(serialized);
  return {
    kind,
    data: compressedBuffer,
    serializedBytes,
  };
}

export function decodePayload(
  input: unknown,
  kind: CompressionKind,
  adapter?: CompressionAdapter,
): unknown {
  if (kind === 'none') {
    return input;
  }

  if (!adapter) {
    error(`Fossix compression '${kind}' configured without a compression adapter.`);
  }

  if (!typeIs(input, 'buffer')) {
    error('Fossix expected a compressed buffer payload but got a different value type.');
  }

  const decompressed = adapter.decompress(input);
  return HttpService.JSONDecode(decompressed);
}
