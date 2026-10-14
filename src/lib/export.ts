import ExcelJS from 'exceljs'
import PDFDocument from 'pdfkit'

export type ExportColumn = {
  header: string
  key: string
  width?: number
}

export type ExportRow = Record<string, unknown>

export async function buildXlsx(
  sheetName: string,
  columns: ExportColumn[],
  rows: ExportRow[],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet(sheetName)
  sheet.columns = columns.map((column) => ({
    header: column.header,
    key: column.key,
    width: column.width ?? 20,
  }))
  for (const row of rows) sheet.addRow(row)
  sheet.getRow(1).font = { bold: true }

  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}

function truncate(doc: PDFKit.PDFDocument, text: string, maxWidth: number): string {
  if (doc.widthOfString(text) <= maxWidth) return text
  let result = text
  while (result.length > 0 && doc.widthOfString(`${result}…`) > maxWidth) {
    result = result.slice(0, -1)
  }
  return `${result}…`
}

export function buildPdf(
  title: string,
  columns: ExportColumn[],
  rows: ExportRow[],
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4', layout: 'landscape' })
    const chunks: Uint8Array[] = []
    doc.on('data', (chunk) => chunks.push(chunk as Uint8Array))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    const startX = doc.page.margins.left
    const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right
    const bottom = doc.page.height - doc.page.margins.bottom
    const weights = columns.map((column) => column.width ?? 20)
    const totalWeight = weights.reduce((total, weight) => total + weight, 0)
    const widths = weights.map((weight) => (usableWidth * weight) / totalWeight)

    const rowHeight = 14
    const headerHeight = 18

    doc.font('Helvetica-Bold').fontSize(16).text(title, { align: 'center' })
    let y = doc.y + 10

    const drawHeader = () => {
      doc.font('Helvetica-Bold').fontSize(9)
      let x = startX
      columns.forEach((column, index) => {
        doc.text(truncate(doc, column.header, widths[index]! - 4), x, y, {
          width: widths[index]! - 4,
          lineBreak: false,
        })
        x += widths[index]!
      })
      doc
        .moveTo(startX, y + headerHeight - 5)
        .lineTo(startX + usableWidth, y + headerHeight - 5)
        .strokeColor('#999999')
        .stroke()
      y += headerHeight
      doc.font('Helvetica').fontSize(8)
    }

    drawHeader()

    for (const row of rows) {
      if (y > bottom - rowHeight) {
        doc.addPage()
        y = doc.page.margins.top
        drawHeader()
      }
      let x = startX
      columns.forEach((column, index) => {
        const value = row[column.key]
        const text = value === null || value === undefined ? '-' : String(value)
        doc.text(truncate(doc, text, widths[index]! - 4), x, y, {
          width: widths[index]! - 4,
          lineBreak: false,
        })
        x += widths[index]!
      })
      y += rowHeight
    }

    doc.end()
  })
}
