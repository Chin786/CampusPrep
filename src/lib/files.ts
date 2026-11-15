import Papa from 'papaparse'
export function csv(name: string, rows: unknown[][]) {
  const safe = rows.map((r) =>
    r.map((v) =>
      typeof v === 'string' && /^[=+@\-\t\r]/.test(v) ? "'" + v : v,
    ),
  )
  const url = URL.createObjectURL(
    new Blob(['\ufeff' + Papa.unparse(safe)], {
      type: 'text/csv;charset=utf-8',
    }),
  )
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export async function readRows(file: File): Promise<Record<string, string>[]> {
  if (file.size > 8e6) throw Error('Use a file smaller than 8 MB.')
  if (/\.xlsx$/i.test(file.name)) {
    const { Workbook } = await import('exceljs')
    const wb = new Workbook()
    await wb.xlsx.load(await file.arrayBuffer())
    const sheet = wb.worksheets[0]
    if (!sheet) throw Error('Empty workbook.')
    const headers: string[] = []
    sheet.getRow(1).eachCell((c, i) => {
      headers[i] = c.text.trim()
    })
    const out: Record<string, string>[] = []
    sheet.eachRow((r, n) => {
      if (n > 1) {
        const row: Record<string, string> = {}
        headers.forEach((h, i) => (row[h] = r.getCell(i).text.trim()))
        out.push(row)
      }
    })
    return out
  }
  const r = Papa.parse<Record<string, string>>(
    (await file.text()).replace(/^\ufeff/, ''),
    {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (h) => h.trim(),
    },
  )
  if (r.errors.length) throw Error(r.errors[0].message)
  if (!r.data.length) throw Error('The file has no data rows.')
  return r.data
}
