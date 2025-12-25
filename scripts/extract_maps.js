import fs from 'fs';
import path from 'path';

const javaFilePath = path.join(process.cwd(), 'javasource/main/java/org/data/mapdata.java');
const outputFilePath = path.join(process.cwd(), 'src/game/mapData.ts');

function extractMaps() {
    const content = fs.readFileSync(javaFilePath, 'utf-8');
    
    // Find the maps array content
    const startMatch = content.indexOf('{');
    const endMatch = content.lastIndexOf('}');
    
    // This is a bit naive but should work for the structure of mapdata.java
    // We want the content inside the outer-most braces of the maps array
    const mapsContentMatch = content.match(/public static int\[\]\[\]\[\] maps = \{([\s\S]*?)\};/);
    
    if (!mapsContentMatch) {
        console.error('Could not find maps array in Java file');
        return;
    }

    let mapsRaw = mapsContentMatch[1];
    
    // Clean up Java-specific syntax if any (though here it's mostly just arrays)
    // Convert { } to [ ]
    let tsContent = mapsRaw
        .replace(/\{/g, '[')
        .replace(/\}/g, ']')
        .replace(/\/\/.*/g, ''); // Remove comments

    const finalFileContent = `export const MAP_DATA: number[][][] = [${tsContent}];\n`;
    
    fs.writeFileSync(outputFilePath, finalFileContent);
    console.log(`Successfully extracted maps to ${outputFilePath}`);
}

extractMaps();
