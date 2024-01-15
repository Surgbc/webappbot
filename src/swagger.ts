const fs = require('fs-extra')
const path = require('path')

const linesToComment = [
  'RightDelim:       "}}",',
  'LeftDelim:        "{{",',
];

const removeDelims = () =>{
  const filePath = path.join(process.cwd(), "docs", "docs.go")
  const fileContent = fs.readFileSync(filePath, 'utf-8');
  const updatedContent = fileContent.replace(
    new RegExp(`^\\s*(${linesToComment.join('|')})`, 'gm'),
    (match) => `// ${match}`
  );

  fs.writeFileSync(filePath, updatedContent, 'utf-8');
}

const { exec } = require('child_process');

const runSwagInit = async () => {
  return new Promise((resolve)=>{
  const command = 'swag init --parseDependency --parseInternal';

  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.error(`Error: ${error.message}`);
      return;
    }

    if (stderr) {
      console.error(`stderr: ${stderr}`);
      return;
    }

    console.log(`stdout: ${stdout}`);
    resolve(true)
  });
})
}

const swagger = {
  removeDelims,
  runSwagInit
}
export {
  // removeDelims,
  // runSwagInit
  swagger
}