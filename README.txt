1. Project setup.

      Install node modules. Inside the project root folder, run in the console:

          npm i

2. Run the project.

      Inside the project root folder, run in the console:

          npm start

      then navigate to the url that will show up in the console log (e.g. http://localhost:1234)

3. Environment.

      Environment files can be placed in subfolders of the /static folder

4. Build the project.

      Inside the project root folder, run in the console:

          npm run build

      build files will appear inside the /dist folder

files:
      src/index.js - setup example
      src/Panorama3D.js - main class
      /static/[000, 0001, ...] - subfolders for environments

Switch environments url example:

    [baseURL]/[subfolder name]/
    
    http://localhost:1234/000/
    http://localhost:1234/001/
    ...