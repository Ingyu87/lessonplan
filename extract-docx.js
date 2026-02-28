const mammoth = require('mammoth');
const path = require('path');
const fs = require('fs');

const docxPath = path.join(__dirname, '장학자료.docx');
const outPath = path.join(__dirname, '장학자료_텍스트.txt');

mammoth.extractRawText({ path: docxPath })
  .then((result) => {
    fs.writeFileSync(outPath, result.value, 'utf8');
    console.log('Extracted to 장학자료_텍스트.txt, length:', result.value.length);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
