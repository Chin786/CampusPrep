import { jsPDF } from 'jspdf'
import { autoTable } from 'jspdf-autotable'

export function downloadReportPdf(
  title: string,
  schedule: string,
  columns: readonly string[],
  rows: Record<string, string | number>[],
) {
  const doc = new jsPDF({
    orientation: columns.length > 4 ? 'landscape' : 'portrait',
    unit: 'mm',
  })
  const margin = 14
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(17)
  doc.text(title, margin, 19)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  const subtitle = doc.splitTextToSize(
    schedule,
    doc.internal.pageSize.getWidth() - margin * 2,
  )
  doc.text(subtitle, margin, 27)
  autoTable(doc, {
    head: [columns.map((c) => c.replaceAll('_', ' '))],
    body: rows.map((row) => columns.map((c) => String(row[c] ?? ''))),
    margin: { left: margin, right: margin, bottom: 16 },
    startY: 32 + (subtitle.length - 1) * 4,
    theme: 'grid',
    styles: { fontSize: 9, overflow: 'linebreak' },
    headStyles: { fillColor: [22, 65, 89] },
    didDrawPage: () => {
      doc.setFontSize(9)
      doc.text(
        'CampusPrep CBT  |  ' + doc.getNumberOfPages(),
        margin,
        doc.internal.pageSize.getHeight() - 7,
      )
    },
  })
  doc.save(title.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.pdf')
}
