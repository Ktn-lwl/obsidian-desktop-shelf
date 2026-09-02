type ISBN10 = string & { __brand: "ISBN10" };
type ISBN13 = string & { __brand: "ISBN13" };

export function is_isbn(value : string): asserts value is ISBN10|ISBN13 {
    let sum = 0;
    let isValid = false;

    if (value.length === 10) {
        for (let i = 0; i < 9; i++) {
            sum += Number(value.charAt(i)) * (10 - i);
        }
        
        // Handle the 'X' check digit for ISBN-10
        const lastChar = value.charAt(9).toUpperCase();
        sum += lastChar === 'X' ? 10 : Number(lastChar);

        isValid = sum % 11 === 0;
    } 
    else if (value.length === 13) {
        for (let i = 0; i < 13; i++) {
            const digit = Number(value.charAt(i));
            sum += (i % 2 === 0) ? digit : digit * 3;
        }
        
        isValid = sum % 10 === 0;
    }

    if (!isValid){
        throw new Error(`${value} is not a valid ISBN!`);
    }

}

export type {
    ISBN10,
    ISBN13,
}
