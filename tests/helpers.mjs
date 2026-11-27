export function nestSelection(depth, field = 'a') {
  return (('{ ' + field).repeat(depth) + '}'.repeat(depth)).replaceAll('{ ', '{');
}

export function aliasAmplification(count, field = 'login') {
  const parts = [];
  for (let index = 1; index <= count; index += 1) parts.push('a' + index + ': ' + field);
  return '{ ' + parts.join(' ') + ' }';
}

export function repeatedField(count, field = 'x') {
  return '{ ' + Array.from({ length: count }, () => field).join(' ') + ' }';
}

export function directiveBurst(count, perLocation = false) {
  if (perLocation) return '{ x ' + '@d'.repeat(count) + ' }';
  const parts = [];
  for (let index = 0; index < count; index += 1) parts.push('f' + index + ' @d');
  return '{ ' + parts.join(' ') + ' }';
}

export function fragmentDag(levels) {
  const parts = [];
  for (let level = 1; level <= levels; level += 1) {
    const next = level < levels ? ' ...F' + (level + 1) + ' ...F' + (level + 1) : ' leaf';
    parts.push('fragment F' + level + ' on T { f' + level + next + ' }');
  }
  return parts.join('\n') + '\nquery Q { ...F1 }';
}

export function findingCodes(report) {
  return report.findings.map((finding) => finding.code);
}

export function hasFinding(report, code) {
  return report.findings.some((finding) => finding.code === code);
}
